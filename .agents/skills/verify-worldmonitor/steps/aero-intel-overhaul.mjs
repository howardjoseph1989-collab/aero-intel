import { seedProfile, waitForBoot, waitForMap } from './_profile.mjs';

/**
 * AERO INTEL overhaul: no live-TV box above webcams, ISS/Earth wall,
 * bottom Global Situation, US-first briefing, AERO GEMINI chrome + stubbed tool call.
 */
export default async function ({ page, base, shot, log, expectVisible }) {
  await page.route('**/api/aero-gemini', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          available: true,
          provider: 'gemini',
          mode: 'turn',
          model: 'gemini-2.5-flash',
          toolCount: 8,
        }),
      });
      return;
    }
    const body = request.postDataJSON() || {};
    if (Array.isArray(body.toolResults) && body.toolResults.length) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          text: 'US Local is on screen. ISS Earth View is first on the wall.',
          functionCalls: [],
          history: [],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        functionCalls: [{ name: 'get_news_brief', args: { hierarchy: 'us-local' } }],
        text: null,
        history: [],
      }),
    });
  });

  await seedProfile(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page, { data: true });
  await waitForMap(page);

  const liveAboveMain = await page.evaluate(() => {
    const main = document.getElementById('main');
    const strip = document.getElementById('liveVideoStrip')
      || document.querySelector(':scope > .live-video-strip');
    if (!main || !strip || !document.body.contains(strip)) return false;
    const parent = main.parentElement;
    if (!parent || strip.parentElement !== parent) return false;
    return [...parent.children].indexOf(strip) < [...parent.children].indexOf(main);
  });
  if (liveAboveMain) throw new Error('Live video strip is still above main');

  await expectVisible('#aeroGeminiMount .aero-gemini-toggle');
  await shot('gemini-chrome', { locator: page.locator('.header[role="banner"]') });

  const webcams = page.locator('#panelsGrid .panel[data-panel="live-webcams"]');
  await webcams.scrollIntoViewIfNeeded();
  await webcams.hover();
  await webcams.locator('.webcam-preview-tile[data-feed-id], .webcam-city').first().waitFor({ timeout: 15_000 });
  const gridIds = await webcams.locator('.webcam-preview-tile[data-feed-id]').evaluateAll((els) => (
    els.map((el) => el.getAttribute('data-feed-id') || '')
  ));
  log('webcam wall', gridIds.join(','));
  if (gridIds[0] !== 'iss-earth' || gridIds[1] !== 'nasa-live') {
    throw new Error(`Webcam wall did not start ISS/Earth then NASA: ${gridIds.join(',')}`);
  }
  await shot('webcams-iss-first', { locator: webcams });

  const briefing = page.locator('#newsBriefingSurface');
  await expectVisible('#newsBriefingSurface');
  await briefing.scrollIntoViewIfNeeded();
  const briefingUs = await briefing.locator('.news-hierarchy-chip.active').textContent();
  log('briefing chip', briefingUs);
  await shot('us-first-briefing', { locator: briefing });

  const mapBelow = await page.evaluate(() => {
    const map = document.getElementById('mapSection')?.getBoundingClientRect();
    const grid = document.getElementById('panelsGrid')?.getBoundingClientRect();
    return Boolean(map && grid && map.top >= grid.top - 8);
  });
  if (!mapBelow) throw new Error('Global Situation is not below the panel grid');
  await shot('bottom-global-situation', { locator: page.locator('#mapSection') });

  await page.locator('.aero-gemini-toggle').click();
  await expectVisible('#aeroGeminiPanel');
  await page.locator('.aero-gemini-input').fill('Brief me on US local news');
  await page.locator('.aero-gemini-send').click();
  await page.locator('.aero-gemini-row-tool').waitFor({ timeout: 15_000 });
  const toolRow = await page.locator('.aero-gemini-row-tool').first().textContent();
  log('tool call', toolRow);
  await shot('gemini-tool-call', { locator: page.locator('#aeroGeminiPanel') });
  await shot('dashboard-overview');
}
