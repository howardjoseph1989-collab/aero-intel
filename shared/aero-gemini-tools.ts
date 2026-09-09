/**
 * Gemini function-declaration catalog for AERO GEMINI.
 * Zero-import so both the edge broker and tests can load it.
 */

export interface AeroGeminiToolSpec {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

const OBJECT = { type: 'object', properties: {} as Record<string, unknown> };

export const AERO_GEMINI_TOOL_SPECS: AeroGeminiToolSpec[] = [
  {
    name: 'get_dashboard_context',
    description: 'Read a bounded snapshot of the visible AERO INTEL dashboard: variant, map view, layers, and panels.',
    parameters: OBJECT,
  },
  {
    name: 'get_news_brief',
    description: 'Read the current US-first news briefing stream: large titles and body excerpts currently on screen.',
    parameters: {
      type: 'object',
      properties: {
        hierarchy: {
          type: 'string',
          description: 'Optional stream: us-local, us, politics, markets, other.',
        },
      },
    },
  },
  {
    name: 'search_dashboard',
    description: 'Search countries, signals, and dashboard entities.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_search',
    description: 'Open the command palette search.',
    parameters: OBJECT,
  },
  {
    name: 'list_map_layers',
    description: 'List map layers the operator can toggle.',
    parameters: OBJECT,
  },
  {
    name: 'set_map_layers',
    description: 'Enable or disable named map layers.',
    parameters: {
      type: 'object',
      properties: {
        layers: {
          type: 'object',
          description: 'Map of layer id to boolean enabled.',
        },
      },
      required: ['layers'],
    },
  },
  {
    name: 'set_map_view',
    description: 'Move the Global Situation map camera.',
    parameters: {
      type: 'object',
      properties: {
        lat: { type: 'number' },
        lon: { type: 'number' },
        zoom: { type: 'number' },
        view: { type: 'string', description: 'Named view such as america, global, europe.' },
      },
    },
  },
  {
    name: 'set_map_mode',
    description: 'Switch the Global Situation renderer between 2d and 3d.',
    parameters: {
      type: 'object',
      properties: { mode: { type: 'string', description: '2d or 3d' } },
      required: ['mode'],
    },
  },
  {
    name: 'focus_country',
    description: 'Focus the map on a country by ISO 3166-1 alpha-2 code.',
    parameters: {
      type: 'object',
      properties: { iso2: { type: 'string' } },
      required: ['iso2'],
    },
  },
  {
    name: 'open_country_brief',
    description: 'Open the country intelligence brief panel.',
    parameters: {
      type: 'object',
      properties: { iso2: { type: 'string' } },
      required: ['iso2'],
    },
  },
  {
    name: 'list_dashboard_panels',
    description: 'List dashboard panels the operator can open or arrange.',
    parameters: OBJECT,
  },
  {
    name: 'open_dashboard_panel',
    description: 'Open and focus a dashboard panel by id (for example live-webcams, us-local, us).',
    parameters: {
      type: 'object',
      properties: { panelId: { type: 'string' } },
      required: ['panelId'],
    },
  },
  {
    name: 'set_panel_enabled',
    description: 'Show or hide a catalog panel.',
    parameters: {
      type: 'object',
      properties: {
        panelId: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['panelId', 'enabled'],
    },
  },
  {
    name: 'set_panel_collapsed',
    description: 'Collapse or expand a panel.',
    parameters: {
      type: 'object',
      properties: {
        panelId: { type: 'string' },
        collapsed: { type: 'boolean' },
      },
      required: ['panelId', 'collapsed'],
    },
  },
  {
    name: 'move_panel',
    description: 'Move a panel in the grid (region + index).',
    parameters: {
      type: 'object',
      properties: {
        panelId: { type: 'string' },
        region: { type: 'string', description: 'grid or bottom' },
        index: { type: 'number' },
      },
      required: ['panelId'],
    },
  },
  {
    name: 'get_panel_layout',
    description: 'Read current panel order, collapse, and fullscreen state.',
    parameters: OBJECT,
  },
  {
    name: 'set_news_stream',
    description: 'Switch the single large news briefing to US Local, US National, World, Markets, or Other.',
    parameters: {
      type: 'object',
      properties: {
        hierarchy: {
          type: 'string',
          description: 'us-local | us | politics | markets | other',
        },
      },
      required: ['hierarchy'],
    },
  },
  {
    name: 'set_webcam_view',
    description: 'Show ISS / Earth view or a region of live webcams. Prefer iss-earth and nasa-live at start.',
    parameters: {
      type: 'object',
      properties: {
        feedId: { type: 'string', description: 'iss-earth, nasa-live, washington, new-york, …' },
        region: { type: 'string', description: 'space | americas | europe | middle-east | asia | all' },
      },
    },
  },
  {
    name: 'set_live_station',
    description: 'Select a live TV station (Fox, CNN, MSNBC, …). Stations are not a box above webcams.',
    parameters: {
      type: 'object',
      properties: { stationId: { type: 'string' } },
      required: ['stationId'],
    },
  },
  {
    name: 'set_global_situation_height',
    description: 'Resize the bottom Global Situation map strip by pixel height (drag-up equivalent).',
    parameters: {
      type: 'object',
      properties: { heightPx: { type: 'number' } },
      required: ['heightPx'],
    },
  },
  {
    name: 'open_settings',
    description: 'Open the settings overlay.',
    parameters: OBJECT,
  },
  {
    name: 'list_mission_presets',
    description: 'List bundled mission presets.',
    parameters: OBJECT,
  },
  {
    name: 'apply_mission_preset',
    description: 'Apply a bundled mission preset by id.',
    parameters: {
      type: 'object',
      properties: { presetId: { type: 'string' } },
      required: ['presetId'],
    },
  },
];
