import { fetchLiveVideoInfo } from '@/services/live-news';
import {
  DEFAULT_LIVE_VIDEO_STATION_ID,
  LIVE_VIDEO_STATIONS,
  getLiveVideoStation,
  youtubeEmbedUrl,
  youtubeLivePageUrl,
  type LiveVideoStation,
} from '@/config/live-video-stations';
import { NEWS_HIERARCHY } from '@/config/product';
import { sanitizeUrl } from '@/utils/sanitize';
import { safeStorageGet, safeStorageSet } from '@/utils/safe-storage';

const STORAGE_KEY = 'aero-intel-live-station';

export class LiveVideoStrip {
  private root: HTMLElement;
  private playerEl: HTMLElement;
  private statusEl: HTMLElement;
  private muteBtn: HTMLButtonElement;
  private activeId = DEFAULT_LIVE_VIDEO_STATION_ID;
  private muted = true;
  private generation = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.classList.add('live-video-strip');
    this.root.setAttribute('aria-label', 'Live video feeds');

    const saved = this.readSavedStation();
    if (saved && getLiveVideoStation(saved)) this.activeId = saved;

    const header = document.createElement('div');
    header.className = 'live-video-strip-header';

    const title = document.createElement('h2');
    title.className = 'live-video-strip-title';
    title.textContent = 'Live video feeds';
    header.appendChild(title);

    this.statusEl = document.createElement('span');
    this.statusEl.className = 'live-video-strip-status';
    this.statusEl.textContent = 'Muted';
    header.appendChild(this.statusEl);

    this.muteBtn = document.createElement('button');
    this.muteBtn.type = 'button';
    this.muteBtn.className = 'live-video-strip-mute';
    this.muteBtn.textContent = 'Unmute';
    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      this.muteBtn.textContent = this.muted ? 'Unmute' : 'Mute';
      this.statusEl.textContent = this.muted ? 'Muted' : 'Sound on';
      void this.loadStation(this.activeId);
    });
    header.appendChild(this.muteBtn);

    const chips = document.createElement('div');
    chips.className = 'live-video-strip-chips';
    chips.setAttribute('role', 'tablist');
    chips.setAttribute('aria-label', 'US live stations');
    for (const station of LIVE_VIDEO_STATIONS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'live-video-chip';
      chip.dataset.station = station.id;
      chip.setAttribute('role', 'tab');
      chip.textContent = station.name;
      if (station.optional) chip.dataset.optional = 'true';
      chip.addEventListener('click', () => {
        this.activeId = station.id;
        safeStorageSet(STORAGE_KEY, station.id);
        this.syncChipState();
        void this.loadStation(station.id);
      });
      chips.appendChild(chip);
    }

    this.playerEl = document.createElement('div');
    this.playerEl.className = 'live-video-strip-player';

    this.root.replaceChildren(header, chips, this.playerEl);
    this.syncChipState();
    void this.loadStation(this.activeId);
  }

  private readSavedStation(): string | null {
    return safeStorageGet(STORAGE_KEY);
  }

  private syncChipState(): void {
    for (const chip of this.root.querySelectorAll<HTMLButtonElement>('.live-video-chip')) {
      const selected = chip.dataset.station === this.activeId;
      chip.classList.toggle('active', selected);
      chip.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
  }

  private showFallback(station: LiveVideoStation, reason: string): void {
    const watchUrl = sanitizeUrl(youtubeLivePageUrl(station.handle));
    const wrap = document.createElement('div');
    wrap.className = 'live-video-strip-fallback';

    const msg = document.createElement('p');
    msg.textContent = `${station.name} embed is unavailable (${reason}).`;
    wrap.appendChild(msg);

    const link = document.createElement('a');
    link.href = watchUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `Open ${station.name} on YouTube`;
    wrap.appendChild(link);

    this.playerEl.replaceChildren(wrap);
  }

  private renderYoutube(station: LiveVideoStation, videoId: string): void {
    const iframe = document.createElement('iframe');
    iframe.className = 'live-video-strip-frame';
    iframe.src = youtubeEmbedUrl(videoId, this.muted);
    iframe.title = `${station.name} live`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.addEventListener('error', () => {
      this.showFallback(station, 'player failed to load');
    });
    this.playerEl.replaceChildren(iframe);
  }

  private renderHls(station: LiveVideoStation, hlsUrl: string): void {
    const video = document.createElement('video');
    video.className = 'live-video-strip-video';
    video.muted = this.muted;
    video.autoplay = true;
    video.playsInline = true;
    video.controls = true;
    video.setAttribute('aria-label', `${station.name} live stream`);

    const note = document.createElement('p');
    note.className = 'live-video-strip-hls-note';
    note.textContent = 'YouTube embed unavailable — playing documented HLS fallback.';

    const applyHls = async () => {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        return;
      }
      try {
        const { default: Hls } = await import('hls.js');
        if (!Hls.isSupported()) {
          this.showFallback(station, 'HLS not supported');
          return;
        }
        const hls = new Hls();
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, () => {
          this.showFallback(station, 'HLS blocked');
        });
      } catch {
        this.showFallback(station, 'HLS unavailable');
      }
    };

    this.playerEl.replaceChildren(video, note);
    void applyHls();
  }

  private async loadStation(id: string): Promise<void> {
    const station = getLiveVideoStation(id);
    if (!station) return;
    const token = ++this.generation;
    this.playerEl.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'live-video-strip-loading';
    loading.textContent = `Loading ${station.name}…`;
    this.playerEl.appendChild(loading);

    const info = await fetchLiveVideoInfo(station.handle);
    if (token !== this.generation) return;

    const videoId = info.videoId || station.fallbackVideoId;
    if (videoId) {
      this.renderYoutube(station, videoId);
      return;
    }
    if (station.hlsUrl) {
      this.renderHls(station, station.hlsUrl);
      return;
    }
    this.showFallback(station, 'no live video id');
  }
}

export function mountLiveVideoStrip(root: HTMLElement): LiveVideoStrip {
  return new LiveVideoStrip(root);
}

export function mountNewsHierarchyBar(root: HTMLElement): void {
  root.classList.add('news-hierarchy-bar');
  root.setAttribute('aria-label', 'News hierarchy');

  const label = document.createElement('span');
  label.className = 'news-hierarchy-label';
  label.textContent = 'News';
  root.appendChild(label);

  for (const entry of NEWS_HIERARCHY) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'news-hierarchy-chip';
    chip.dataset.hierarchy = entry.id;
    chip.dataset.panel = entry.panelId ?? entry.id;
    chip.textContent = entry.label;
    chip.addEventListener('click', () => {
      const panelId = entry.panelId ?? entry.id;
      const panel = document.querySelector<HTMLElement>(`#panelsGrid .panel[data-panel="${panelId}"]`);
      for (const other of root.querySelectorAll('.news-hierarchy-chip')) {
        other.classList.toggle('active', other === chip);
      }
      panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    if (entry.id === 'us-local') chip.classList.add('active');
    root.appendChild(chip);
  }
}
