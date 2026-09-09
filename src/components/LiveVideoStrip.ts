import { fetchLiveVideoInfo } from '@/services/live-news';
import {
  DEFAULT_LIVE_VIDEO_STATION_ID,
  LIVE_VIDEO_STATIONS,
  getLiveVideoStation,
  isYoutubeEmbedFailure,
  pickLiveVideoPlayback,
  pickPlaybackAfterYoutubeFailure,
  youtubeEmbedUrl,
  youtubeLivePageUrl,
  type LiveVideoStation,
} from '@/config/live-video-stations';
import { NEWS_HIERARCHY } from '@/config/product';
import {
  AERO_INTEL_LIVE_STATION_EVENT,
} from '@/services/aero-gemini-actions';
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
  private youtubeWatchCleanup: (() => void) | null = null;
  private hlsPlayer: import('hls.js').default | null = null;

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
    window.addEventListener(AERO_INTEL_LIVE_STATION_EVENT, this.boundStationCommand);
  }

  private readonly boundStationCommand = (event: Event): void => {
    const stationId = String((event as CustomEvent<{ stationId?: string }>).detail?.stationId || '');
    if (stationId) this.selectStation(stationId);
  };

  public selectStation(id: string): boolean {
    if (!getLiveVideoStation(id)) return false;
    this.activeId = id;
    safeStorageSet(STORAGE_KEY, id);
    this.syncChipState();
    void this.loadStation(id);
    return true;
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

  private clearMedia(): void {
    this.youtubeWatchCleanup?.();
    this.youtubeWatchCleanup = null;
    if (this.hlsPlayer) {
      this.hlsPlayer.destroy();
      this.hlsPlayer = null;
    }
  }

  private applyPlaybackChoice(
    station: LiveVideoStation,
    choice: ReturnType<typeof pickLiveVideoPlayback>,
    reason: string,
    hlsAfterYoutubeError = false,
  ): void {
    if (choice.kind === 'youtube') {
      this.renderYoutube(station, choice.videoId);
      return;
    }
    if (choice.kind === 'hls') {
      this.renderHls(station, choice.hlsUrl, hlsAfterYoutubeError);
      return;
    }
    this.showFallback(station, reason);
  }

  private showFallback(station: LiveVideoStation, reason: string): void {
    this.clearMedia();
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

  private fallbackFromYoutube(station: LiveVideoStation, token: number, reason: string): void {
    if (token !== this.generation) return;
    this.applyPlaybackChoice(station, pickPlaybackAfterYoutubeFailure(station), reason, true);
  }

  private renderYoutube(station: LiveVideoStation, videoId: string): void {
    const token = this.generation;
    this.clearMedia();
    const iframe = document.createElement('iframe');
    iframe.className = 'live-video-strip-frame';
    iframe.dataset.liveSource = 'youtube';
    iframe.dataset.station = station.id;
    iframe.src = youtubeEmbedUrl(videoId, this.muted, window.location.origin);
    iframe.title = `${station.name} live`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.addEventListener('error', () => {
      this.fallbackFromYoutube(station, token, 'player failed to load');
    });

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const code = youtubePlayerErrorCode(event.data);
      if (code === null) return;
      const reason = isYoutubeEmbedFailure(code) || code > 0
        ? `youtube error ${code}`
        : 'unavailable';
      this.fallbackFromYoutube(station, token, reason);
    };
    window.addEventListener('message', onMessage);
    this.youtubeWatchCleanup = () => window.removeEventListener('message', onMessage);

    iframe.addEventListener('load', () => {
      try {
        iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: videoId }), '*');
      } catch {
        /* ignore handshake failures; onError still arrives when the API is ready */
      }
    });

    this.playerEl.replaceChildren(iframe);
  }

  private renderHls(station: LiveVideoStation, hlsUrl: string, afterYoutubeError = false): void {
    const token = this.generation;
    this.clearMedia();
    const video = document.createElement('video');
    video.className = 'live-video-strip-video';
    video.dataset.liveSource = 'hls';
    video.dataset.station = station.id;
    video.muted = this.muted;
    video.autoplay = true;
    video.playsInline = true;
    video.controls = true;
    video.setAttribute('aria-label', `${station.name} live stream`);

    const failHls = (reason: string) => {
      if (token !== this.generation) return;
      this.showFallback(station, reason);
    };

    const applyHls = async () => {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        video.addEventListener('error', () => failHls('HLS blocked'));
        void video.play()?.catch(() => {});
        return;
      }
      try {
        const { default: Hls } = await import('hls.js');
        if (token !== this.generation) return;
        if (!Hls.isSupported()) {
          failHls('HLS not supported');
          return;
        }
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        this.hlsPlayer = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          void video.play()?.catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) failHls('HLS blocked');
        });
      } catch {
        failHls('HLS unavailable');
      }
    };

    if (afterYoutubeError) {
      const note = document.createElement('p');
      note.className = 'live-video-strip-hls-note';
      note.textContent = 'YouTube embed unavailable — playing documented HLS fallback.';
      this.playerEl.replaceChildren(video, note);
    } else {
      this.playerEl.replaceChildren(video);
    }
    void applyHls();
  }

  private async loadStation(id: string): Promise<void> {
    const station = getLiveVideoStation(id);
    if (!station) return;
    const token = ++this.generation;
    this.clearMedia();
    this.playerEl.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'live-video-strip-loading';
    loading.textContent = `Loading ${station.name}…`;
    this.playerEl.appendChild(loading);

    const info = await fetchLiveVideoInfo(station.handle);
    if (token !== this.generation) return;

    // Live YouTube id → documented HLS → stale fallbackVideoId. Never let a
    // dead fallback embed (e.g. LiveNOW QaftgYkG-ek) block Fox HLS on Vite.
    this.applyPlaybackChoice(
      station,
      pickLiveVideoPlayback(station, info.videoId),
      'no live video id',
    );
  }
}

function youtubePlayerErrorCode(raw: unknown): number | null {
  let data = raw;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const rec = data as { event?: unknown; info?: unknown };
  if (rec.event !== 'onError' && rec.event !== 'error') return null;
  if (typeof rec.info === 'number') return rec.info;
  if (typeof rec.info === 'string' && /^\d+$/.test(rec.info)) return Number(rec.info);
  return 0;
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
