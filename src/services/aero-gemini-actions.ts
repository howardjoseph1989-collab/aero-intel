/**
 * Client-side AERO GEMINI tool execution.
 *
 * WebMCP dashboard tools are bound at registration time. Extra AERO INTEL
 * presentation tools dispatch window events that panels already listen for.
 */

export const AERO_INTEL_WEBCAM_EVENT = 'aero-intel:webcam';
export const AERO_INTEL_NEWS_STREAM_EVENT = 'aero-intel:news-stream';
export const AERO_INTEL_LIVE_STATION_EVENT = 'aero-intel:live-station';
export const AERO_INTEL_MAP_HEIGHT_EVENT = 'aero-intel:map-height';

type GeminiExecutor = (
  args: Record<string, unknown>,
  extra?: { signal?: AbortSignal },
) => Promise<unknown> | unknown;

const webMcpExecutors = new Map<string, GeminiExecutor>();

const WEBMCP_NAME_ALIASES: Record<string, string> = {
  open_country_brief: 'openCountryBrief',
  open_search: 'openSearch',
  get_dashboard_context: 'get_dashboard_context',
  search_dashboard: 'search_dashboard',
  list_map_layers: 'list_map_layers',
  set_map_layers: 'set_map_layers',
  set_map_view: 'set_map_view',
  set_map_mode: 'set_map_mode',
  focus_country: 'focus_country',
  list_dashboard_panels: 'list_dashboard_panels',
  open_dashboard_panel: 'open_dashboard_panel',
  set_panel_enabled: 'set_panel_enabled',
  set_panel_collapsed: 'set_panel_collapsed',
  move_panel: 'move_panel',
  get_panel_layout: 'get_panel_layout',
  open_settings: 'open_settings',
  list_mission_presets: 'list_mission_presets',
  apply_mission_preset: 'apply_mission_preset',
};

export function bindAeroGeminiWebMcpTools(
  tools: Array<{ name: string; execute: GeminiExecutor }>,
): void {
  webMcpExecutors.clear();
  for (const tool of tools) {
    webMcpExecutors.set(tool.name, tool.execute);
  }
}

function dispatch(name: string, detail: Record<string, unknown>): { ok: true; result: string } {
  window.dispatchEvent(new CustomEvent(name, { detail }));
  return { ok: true, result: `Dispatched ${name}` };
}

function readNewsBrief(hierarchy?: string): { ok: true; titles: string[]; bodies: string[] } {
  if (hierarchy) {
    window.dispatchEvent(new CustomEvent(AERO_INTEL_NEWS_STREAM_EVENT, { detail: { hierarchy } }));
  }
  const root = document.getElementById('newsBriefingSurface') ?? document.getElementById('panelsGrid');
  const items = root ? [...root.querySelectorAll('.item.clustered, .item')] : [];
  const titles: string[] = [];
  const bodies: string[] = [];
  for (const item of items.slice(0, 12)) {
    const title = item.querySelector('.item-title')?.textContent?.trim();
    const body = item.querySelector('.item-body')?.textContent?.trim()
      ?? item.querySelector('.item-snippet')?.textContent?.trim()
      ?? item.querySelector('.cluster-meta')?.textContent?.trim()
      ?? '';
    if (title) {
      titles.push(title);
      bodies.push(body.slice(0, 280));
    }
  }
  return { ok: true, titles, bodies };
}

export async function executeAeroGeminiTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  try {
    if (name === 'get_news_brief') {
      return readNewsBrief(typeof args.hierarchy === 'string' ? args.hierarchy : undefined);
    }
    if (name === 'set_news_stream' && typeof args.hierarchy === 'string') {
      return dispatch(AERO_INTEL_NEWS_STREAM_EVENT, { hierarchy: args.hierarchy });
    }
    if (name === 'set_webcam_view') {
      return dispatch(AERO_INTEL_WEBCAM_EVENT, {
        feedId: args.feedId,
        region: args.region,
      });
    }
    if (name === 'set_live_station' && typeof args.stationId === 'string') {
      return dispatch(AERO_INTEL_LIVE_STATION_EVENT, { stationId: args.stationId });
    }
    if (name === 'set_global_situation_height' && typeof args.heightPx === 'number') {
      return dispatch(AERO_INTEL_MAP_HEIGHT_EVENT, { heightPx: args.heightPx });
    }

    const webmcpName = WEBMCP_NAME_ALIASES[name] ?? name;
    const execute = webMcpExecutors.get(webmcpName) ?? webMcpExecutors.get(name);
    if (execute) {
      const result = await execute(args, { signal: AbortSignal.timeout(20_000) });
      if (result && typeof result === 'object') {
        return { ok: true, ...(result as Record<string, unknown>) };
      }
      return { ok: true, result };
    }

    return { ok: false, error: `Unknown tool: ${name}` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Tool failed',
    };
  }
}

export function dashboardContextForGemini(): string {
  const titles = readNewsBrief().titles.slice(0, 6);
  const mapTitle = document.querySelector('#mapSection .panel-title')?.textContent?.trim() || 'Global Situation';
  const webcam = document.querySelector('#panelsGrid .panel[data-panel="live-webcams"] .webcam-region-btn.active')?.textContent?.trim();
  return [
    `Surface: ${mapTitle} (bottom strip).`,
    webcam ? `Webcams region: ${webcam}.` : 'Webcams: ISS / Earth preferred.',
    titles.length ? `News titles: ${titles.join(' | ')}` : 'News stream warming up.',
  ].join('\n');
}
