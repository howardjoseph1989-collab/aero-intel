import { NEWS_HIERARCHY } from '@/config/product';
import { AERO_INTEL_NEWS_STREAM_EVENT } from '@/services/aero-gemini-actions';

export const NEWS_BRIEFING_PANEL_KEYS = ['us-local', 'us', 'politics'] as const;

function briefingHost(): HTMLElement {
  let host = document.getElementById('newsBriefingSurface');
  if (host) return host;

  host = document.createElement('section');
  host.id = 'newsBriefingSurface';
  host.className = 'news-briefing-surface panel panel-wide';
  host.setAttribute('data-panel', 'news-briefing');
  host.setAttribute('aria-label', 'News briefing');

  const header = document.createElement('div');
  header.className = 'news-briefing-header';

  const title = document.createElement('h2');
  title.className = 'news-briefing-title';
  title.textContent = 'News briefing';
  header.appendChild(title);

  const chips = document.createElement('nav');
  chips.className = 'news-briefing-chips';
  chips.setAttribute('aria-label', 'News hierarchy');
  for (const entry of NEWS_HIERARCHY) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'news-hierarchy-chip';
    chip.dataset.hierarchy = entry.id;
    chip.dataset.panel = entry.panelId ?? entry.id;
    chip.textContent = entry.label;
    if (entry.id === 'us-local') chip.classList.add('active');
    chip.addEventListener('click', () => setNewsStream(entry.id, entry.panelId ?? entry.id));
    chips.appendChild(chip);
  }
  header.appendChild(chips);

  const stream = document.createElement('div');
  stream.className = 'news-briefing-stream';

  host.append(header, stream);
  return host;
}

export function setNewsStream(hierarchyId: string, panelId = hierarchyId): void {
  const host = document.getElementById('newsBriefingSurface');
  if (!host) return;
  for (const chip of host.querySelectorAll('.news-hierarchy-chip')) {
    chip.classList.toggle('active', (chip as HTMLElement).dataset.hierarchy === hierarchyId);
  }
  const stream = host.querySelector('.news-briefing-stream');
  if (!stream) return;
  const briefing = new Set<string>(NEWS_BRIEFING_PANEL_KEYS);
  for (const panel of stream.querySelectorAll<HTMLElement>('.panel[data-panel]')) {
    const key = panel.dataset.panel || '';
    const show = key === panelId || (!briefing.has(panelId) && key === 'politics' && hierarchyId === 'other');
    panel.classList.toggle('briefing-active', show);
    panel.classList.toggle('hidden', !show);
    panel.hidden = !show;
  }
  const fallback = document.querySelector<HTMLElement>(`#panelsGrid .panel[data-panel="${panelId}"]`);
  if (fallback && !stream.contains(fallback)) {
    fallback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

export function installNewsBriefingSurface(): void {
  const grid = document.getElementById('panelsGrid');
  if (!grid) return;
  const host = briefingHost();
  const stream = host.querySelector('.news-briefing-stream');
  if (!stream) return;

  for (const key of NEWS_BRIEFING_PANEL_KEYS) {
    const panel = document.querySelector<HTMLElement>(`.panel[data-panel="${key}"]`);
    if (panel) stream.appendChild(panel);
  }

  if (host.parentElement !== grid || grid.firstElementChild !== host) {
    grid.insertBefore(host, grid.firstElementChild);
  }

  const active = host.querySelector<HTMLElement>('.news-hierarchy-chip.active');
  const hierarchy = active?.dataset.hierarchy || 'us-local';
  const panelId = active?.dataset.panel || 'us-local';
  setNewsStream(hierarchy, panelId);
}

export function bindNewsBriefingEvents(): void {
  if ((window as Window & { __aeroNewsBriefingBound?: boolean }).__aeroNewsBriefingBound) return;
  (window as Window & { __aeroNewsBriefingBound?: boolean }).__aeroNewsBriefingBound = true;
  window.addEventListener(AERO_INTEL_NEWS_STREAM_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<{ hierarchy?: string }>).detail || {};
    const hierarchy = String(detail.hierarchy || 'us-local');
    const entry = NEWS_HIERARCHY.find((item) => item.id === hierarchy);
    setNewsStream(hierarchy, entry?.panelId ?? hierarchy);
  });
}
