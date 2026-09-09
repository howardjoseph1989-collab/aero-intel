import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAP_STRIP_DEFAULT_PX,
  MAP_STRIP_MIN_PX,
  mapBottomStripHeightFromDrag,
  mapBottomStripHeightFromKeyboard,
} from '../src/app/split-layout.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

describe('AERO INTEL UI overhaul', () => {
  it('does not mount a live-video box above main / webcams', () => {
    const layout = read('src/app/panel-layout.ts');
    assert.doesNotMatch(layout, /id="liveVideoStrip"/);
    assert.doesNotMatch(layout, /id="newsHierarchyBar"/);
    assert.match(layout, /id="aeroGeminiMount"/);
    assert.match(layout, /mountAeroGeminiControl/);
    assert.match(layout, /installNewsBriefingSurface/);
  });

  it('defaults the webcam wall to ISS / Earth then US cities', () => {
    const src = read('src/components/LiveWebcamsPanel.ts');
    assert.match(src, /ALL_GRID_IDS = \['iss-earth', 'nasa-live', 'washington', 'new-york'\]/);
    const feedsStart = src.indexOf('const WEBCAM_FEEDS');
    const iss = src.indexOf("id: 'iss-earth'", feedsStart);
    const washington = src.indexOf("id: 'washington'", feedsStart);
    const jerusalem = src.indexOf("id: 'jerusalem'", feedsStart);
    assert.ok(iss > 0 && washington > iss && jerusalem > washington);
    assert.match(src, /webcam-live-tv-dock/);
  });

  it('puts US Local / US National / webcams before Live News in FULL_PANELS', () => {
    const panels = read('src/config/panels.ts');
    const fullStart = panels.indexOf('const FULL_PANELS');
    const slice = panels.slice(fullStart, panels.indexOf('TECH_PANELS', fullStart));
    const order = [...slice.matchAll(/^\s+'?([\w-]+)'?:\s*\{ name:/gm)].map((m) => m[1]);
    assert.ok(order.indexOf('us-local') < order.indexOf('us'));
    assert.ok(order.indexOf('us') < order.indexOf('live-webcams'));
    assert.ok(order.indexOf('live-webcams') < order.indexOf('politics'));
    assert.ok(order.indexOf('politics') < order.indexOf('live-news'));
    assert.match(slice, /europe: \{ name: 'Europe', enabled: false/);
  });

  it('grows the bottom Global Situation strip when dragging up', () => {
    assert.equal(mapBottomStripHeightFromDrag(280, -40, MAP_STRIP_MIN_PX, 800), 320);
    assert.equal(mapBottomStripHeightFromDrag(280, 200, MAP_STRIP_MIN_PX, 800), MAP_STRIP_MIN_PX);
    assert.equal(mapBottomStripHeightFromKeyboard(280, 'ArrowUp', 40, MAP_STRIP_MIN_PX, 800), 320);
    assert.equal(MAP_STRIP_DEFAULT_PX, 280);
  });

  it('documents GEMINI_API_KEY as a server-only Google AI Studio key', () => {
    const env = read('.env.example');
    assert.match(env, /GEMINI_API_KEY=/);
    assert.match(env, /GOOGLE_API_KEY=/);
    assert.match(env, /Do NOT reuse Maps keys/);
    assert.match(env, /never prefix with VITE_/);
    const readme = read('README.md');
    assert.match(readme, /AERO GEMINI/);
    assert.match(readme, /ISS Earth View/);
    assert.match(readme, /full-width strip on the bottom row/);
    assert.match(readme, /Fox News \(default\)/);
  });
});
