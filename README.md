# AERO INTEL

Personal live intelligence dashboard for William Howard. Display name is always **AERO INTEL** (space between AERO and INTEL).

This repository is a full fork of [koala73/worldmonitor](https://github.com/koala73/worldmonitor) (World Monitor), licensed **AGPL-3.0**. All upstream features, map layers, panels, and APIs are preserved. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the license and required upstream attribution.

## How to run locally

Use **Node.js 24** (see `.nvmrc`).

```bash
git clone https://github.com/howardjoseph1989-collab/aero-intel.git
cd aero-intel
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (override the port with `DEV_PORT` in `.env.local`). The app starts with no environment variables; optional keys are listed in `.env.example`.

```bash
npm run typecheck        # Type checking
npm run build            # Production build (full variant)
```

Other variant dev servers (`npm run dev:tech`, `dev:finance`, …) still exist; AERO INTEL defaults to the full geopolitical dashboard.

## AERO INTEL defaults

### Live video feeds (top strip)

A **Live video feeds** strip sits at the top of the dashboard: one large player plus station chips. **Fox News is selected by default and playback is muted.**

| Station | YouTube live page | Embed / fallback |
|---------|-------------------|------------------|
| Fox News (default) | https://www.youtube.com/@FoxNews/live | YouTube embed via `/api/youtube/live?channel=@FoxNews`. HLS fallback: `https://247preview.foxnews.com/hls/live/2020027/fncv3preview/primary.m3u8` |
| CNN | https://www.youtube.com/@CNN/live | YouTube embed; HLS fallback from the existing live-news catalog |
| MSNBC | https://www.youtube.com/@MSNBC/live | YouTube embed (no documented public HLS) |
| ABC | https://www.youtube.com/@ABCNews/live | YouTube embed; HLS fallback from the live-news catalog |
| NBC | https://www.youtube.com/@NBCNews/live | YouTube embed; HLS fallback from the live-news catalog |
| CBS | https://www.youtube.com/@CBSNews/live | YouTube embed; HLS fallback from the live-news catalog |
| Newsmax | https://www.youtube.com/@NEWSMAX/live | YouTube embed |
| BBC World (optional chip) | https://www.youtube.com/@BBCNews/live | YouTube embed; HLS often UK-geo-restricted |

If YouTube blocks the iframe (embed restriction, bot-check, or no live id), the strip shows a short reason and an **Open on YouTube** link. When a documented HLS URL exists, it is tried next. The original Live News panel remains in the grid with the full upstream channel catalog.

### News hierarchy

Default feed / panel order:

1. **US Local**
2. **US National**
3. **World / International**
4. **Markets**
5. **Other** (Europe and remaining regional desks)

A news-hierarchy bar under the video strip jumps to those panels. Existing regional, intel, markets, and specialty panels are not removed.

### Map

First load (no URL params): `view=america`, `zoom=2.5`, `timeRange=7d`. Default layers keep conflicts, hotspots, sanctions, weather, outages, and natural events on.

### Reading chrome

Dark translucent glass panels with **white** borders and **white, bold, larger** labels for long reading. The map canvas stays clear of chrome overlays.

## What it still does

Everything World Monitor already shipped: curated news, dual map engine (globe.gl + deck.gl/MapLibre), panel inventory, CII, finance radar, variants, Tauri desktop, multilingual UI, MCP/REST. Do not treat this fork as a reduced product.

## License and attribution

**AGPL-3.0-only.** Upstream: [koala73/worldmonitor](https://github.com/koala73/worldmonitor). This fork keeps that license and credits World Monitor contributors in [NOTICE](NOTICE).

Copyright (C) 2024-2026 Elie Habib and World Monitor contributors. AERO INTEL modifications are additional work on the same licensed base.
