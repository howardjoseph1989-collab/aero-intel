/**
 * User-facing product identity for this personal fork.
 * Display name is always all-caps with a space: AERO INTEL.
 * Internal storage keys, proto paths, and upstream API headers stay unchanged.
 */
export const PRODUCT_NAME = 'AERO INTEL';

export const PRODUCT_TAGLINE = 'Personal live intelligence dashboard';

export const PRODUCT_DOCUMENT_TITLE = `${PRODUCT_NAME} — Personal Live Intelligence Dashboard`;

export const AERO_INTEL_DEFAULT_MAP = {
  view: 'america',
  zoom: 2.5,
  timeRange: '7d',
} as const;

export interface NewsHierarchyEntry {
  id: string;
  label: string;
  /** Panel to scroll to when the chip is selected. Defaults to `id`. */
  panelId?: string;
}

/** Default news-panel hierarchy: US local first, then national, world, markets. */
export const NEWS_HIERARCHY: readonly NewsHierarchyEntry[] = [
  { id: 'us-local', label: 'US Local' },
  { id: 'us', label: 'US National' },
  { id: 'politics', label: 'World / International' },
  { id: 'markets', label: 'Markets' },
  { id: 'other', label: 'Other', panelId: 'europe' },
];
