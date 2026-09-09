import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AERO_INTEL_DEFAULT_MAP,
  NEWS_HIERARCHY,
  PRODUCT_NAME,
} from '../src/config/product.ts';
import {
  DEFAULT_LIVE_VIDEO_STATION_ID,
  LIVE_VIDEO_STATIONS,
  getLiveVideoStation,
  pickLiveVideoPlayback,
  pickPlaybackAfterYoutubeFailure,
  youtubeEmbedUrl,
  youtubeLivePageUrl,
} from '../src/config/live-video-stations.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('AERO INTEL product identity', () => {
  it('uses all-caps AERO INTEL with a space', () => {
    assert.equal(PRODUCT_NAME, 'AERO INTEL');
    assert.match(PRODUCT_NAME, /^AERO INTEL$/);
  });

  it('brands package.json, index.html, and README', () => {
    const pkg = JSON.parse(read('package.json')) as { name: string; description: string };
    assert.equal(pkg.name, 'aero-intel');
    assert.match(pkg.description, /AERO INTEL/);
    const html = read('index.html');
    assert.match(html, /<title>AERO INTEL/);
    assert.match(html, /<h1 class="app-heading">AERO INTEL — Personal Live Intelligence Dashboard<\/h1>/);
    assert.match(html, /application-name" content="AERO INTEL"/);
    assert.match(html, /og:site_name" content="AERO INTEL"/);
    assert.doesNotMatch(html, /<title>World Monitor/);
    assert.doesNotMatch(html, /<h1 class="app-heading">World Monitor/);
    const readme = read('README.md');
    assert.match(readme, /^# AERO INTEL/m);
    assert.match(readme, /koala73\/worldmonitor/);
    assert.match(readme, /AGPL/);
    assert.match(readme, /Fox News is selected by default/);
    assert.match(readme, /US Local/);
  });

  it('keeps AGPL license and upstream NOTICE', () => {
    assert.match(read('LICENSE'), /GNU AFFERO GENERAL PUBLIC LICENSE/);
    const notice = read('NOTICE');
    assert.match(notice, /AERO INTEL/);
    assert.match(notice, /koala73\/worldmonitor/);
  });
});

describe('AERO INTEL live video stations', () => {
  it('defaults to muted Fox News with documented fallbacks', () => {
    assert.equal(DEFAULT_LIVE_VIDEO_STATION_ID, 'fox-news');
    assert.equal(LIVE_VIDEO_STATIONS[0]?.id, 'fox-news');
    const names = LIVE_VIDEO_STATIONS.map((s) => s.name);
    assert.deepEqual(names, ['Fox News', 'CNN', 'MSNBC', 'ABC', 'NBC', 'CBS', 'Newsmax', 'BBC World']);
    const fox = LIVE_VIDEO_STATIONS[0]!;
    assert.equal(fox.handle, '@FoxNews');
    assert.ok(fox.hlsUrl?.includes('foxnews.com'));
    assert.equal(fox.fallbackVideoId, undefined);
    assert.equal(youtubeLivePageUrl('@FoxNews'), 'https://www.youtube.com/@FoxNews/live');
    assert.match(youtubeEmbedUrl('abc', true), /mute=1/);
    assert.match(youtubeEmbedUrl('abc', false), /mute=0/);
    assert.match(youtubeEmbedUrl('abc', true), /enablejsapi=1/);
  });

  it('does not keep the LiveNOW QaftgYkG-ek id as a Fox fallback', () => {
    const fox = getLiveVideoStation('fox-news');
    assert.ok(fox);
    assert.notEqual(fox.fallbackVideoId, 'QaftgYkG-ek');
    assert.doesNotMatch(read('src/config/live-video-stations.ts'), /fallbackVideoId:\s*'QaftgYkG-ek'/);
    assert.doesNotMatch(read('src/components/LiveVideoStrip.ts'), /info\.videoId \|\| station\.fallbackVideoId/);
  });

  it('plays documented HLS when YouTube live detection returns no id', () => {
    const fox = getLiveVideoStation('fox-news')!;
    assert.deepEqual(pickLiveVideoPlayback(fox, null), {
      kind: 'hls',
      hlsUrl: fox.hlsUrl,
    });
    assert.deepEqual(pickLiveVideoPlayback(fox, 'dQw4w9wgGcQ'), {
      kind: 'youtube',
      videoId: 'dQw4w9wgGcQ',
    });
  });

  it('does not let a stale fallbackVideoId preempt HLS', () => {
    const station = {
      fallbackVideoId: 'QaftgYkG-ek',
      hlsUrl: 'https://247preview.foxnews.com/hls/live/2020027/fncv3preview/primary.m3u8',
    };
    assert.equal(pickLiveVideoPlayback(station, null).kind, 'hls');
    assert.equal(pickLiveVideoPlayback(station, undefined).kind, 'hls');
    assert.equal(pickPlaybackAfterYoutubeFailure(station).kind, 'hls');
  });

  it('uses fallbackVideoId only when there is no live id and no HLS', () => {
    const station = { fallbackVideoId: 'S-lFBzloL2Y' };
    assert.deepEqual(pickLiveVideoPlayback(station, null), {
      kind: 'youtube',
      videoId: 'S-lFBzloL2Y',
    });
    assert.deepEqual(pickPlaybackAfterYoutubeFailure(station), { kind: 'unavailable' });
  });
});

describe('AERO INTEL news hierarchy and map defaults', () => {
  it('orders news Local → National → World → Markets → Other', () => {
    assert.deepEqual(NEWS_HIERARCHY.map((e) => e.label), [
      'US Local',
      'US National',
      'World / International',
      'Markets',
      'Other',
    ]);
    const panels = read('src/config/panels.ts');
    const keys = [...panels.matchAll(/^\s+['"]?([\w-]+)['"]?:\s*\{ name:/gm)].map((m) => m[1]);
    const local = keys.indexOf('us-local');
    const us = keys.indexOf('us');
    const world = keys.indexOf('politics');
    assert.ok(local >= 0 && us > local && world > us);
  });

  it('defaults the map to America at zoom 2.5 / 7d', () => {
    assert.equal(AERO_INTEL_DEFAULT_MAP.view, 'america');
    assert.equal(AERO_INTEL_DEFAULT_MAP.zoom, 2.5);
    assert.equal(AERO_INTEL_DEFAULT_MAP.timeRange, '7d');
  });
});
