import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { load } from 'js-yaml';

import handler from '../api/md-twin.ts';
import {
  MAX_SIBLING_REDIRECTS,
  MAX_TWIN_BYTES,
  MD_TWIN_LOOP_HEADER,
  buildMarkdownTwinResponse,
  htmlToMarkdown,
  isMarkdownTwinPath,
  resolveMarkdownTwinPath,
  siblingPathFromMarkdown,
} from '../api/_md-url-twin.ts';

describe('markdown URL-fallback helpers', () => {
  it('accepts /{page}.md paths and maps them to the sibling', () => {
    assert.equal(isMarkdownTwinPath('/dashboard.md'), true);
    assert.equal(isMarkdownTwinPath('/stocks/AAPL.md'), true);
    assert.equal(isMarkdownTwinPath('/api/health.md'), true);
    assert.equal(isMarkdownTwinPath('/dashboard'), false);
    assert.equal(isMarkdownTwinPath('/../etc.md'), false);
    assert.equal(siblingPathFromMarkdown('/dashboard.md'), '/dashboard');
    assert.equal(siblingPathFromMarkdown('/api/health.md'), '/api/health');
  });

  it('resolves /api/md-twin?path= to a sanitized .md path', () => {
    const req = new Request('https://www.worldmonitor.app/api/md-twin?path=dashboard');
    assert.equal(resolveMarkdownTwinPath(req), '/dashboard.md');
    const evil = new Request('https://www.worldmonitor.app/api/md-twin?path=https://evil.example/x');
    assert.equal(resolveMarkdownTwinPath(evil), null);
  });

  it('converts HTML to heading-led markdown', () => {
    const md = htmlToMarkdown(
      '<html><head><title>Dashboard</title></head><body><h1>Live map</h1><p>Ships and jets.</p></body></html>',
      'fallback',
    );
    assert.match(md, /^# /m);
    assert.match(md, /Live map/);
    assert.match(md, /Ships and jets/);
    assert.doesNotMatch(md, /<html/i);
  });
});

describe('api/md-twin.ts vary coverage (#7616 U4)', () => {
  it('declares the loop-guard header in Vary so cached twins never replay across variants', async () => {
    const plain = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/dashboard.md'),
      '/dashboard.md',
      async () => new Response('<html><title>T</title><h1>H</h1></html>', { status: 200 }),
    );
    assert.match(plain.headers.get('vary') ?? '', new RegExp(MD_TWIN_LOOP_HEADER, 'i'));

    const looped = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/dashboard.md', {
        headers: { [MD_TWIN_LOOP_HEADER]: '1' },
      }),
      '/dashboard.md',
    );
    assert.equal(looped.status, 404);
    assert.match(looped.headers.get('vary') ?? '', new RegExp(MD_TWIN_LOOP_HEADER, 'i'));
  });
});

describe('api/md-twin.ts', () => {
  it('follows a same-origin redirect and carries the resolved page as canonical', async () => {
    const response = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/countries.md'),
      '/countries.md',
      async (input) =>
        new URL(String(input)).pathname === '/countries'
          ? new Response(null, { status: 308, headers: { Location: '/countries/' } })
          : new Response('<h1>Countries</h1><p>All monitored countries.</p>', {
              headers: { 'Content-Type': 'text/html' },
            }),
    );
    assert.equal(response.status, 200);
    const document = await response.text();
    const block = document.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(block, 'resolved documents must carry metadata');
    assert.deepEqual(load(block[1]), {
      title: 'Countries',
      canonical: 'https://www.worldmonitor.app/countries/',
    });
    assert.match(document, /All monitored countries\./);
  });

  it('adds escaped title and canonical metadata to generated documents', async () => {
    const response = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/example.md'),
      '/example.md',
      async () => new Response('<h1>Title: &quot;quoted&quot;</h1><p>Content.</p>', {
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    const document = await response.text();
    const block = document.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(block);
    assert.deepEqual(load(block[1]), {
      title: 'Title: "quoted"',
      // The HTML sibling, never the .md twin itself (#7860).
      canonical: 'https://www.worldmonitor.app/example',
    });
    assert.match(document, /Content\./);
  });

  it('returns the deprecation policy Link on OPTIONS preflights', async () => {
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/dashboard.md', { method: 'OPTIONS' }),
      '/dashboard.md',
    );

    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('link') ?? '', /rel="deprecation"/);
    assert.match(res.headers.get('link') ?? '', /https:\/\/www\.worldmonitor\.app\/api-versioning\.md/);
  });

  it('returns heading-led markdown for a 200 HTML sibling', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/dashboard');
      assert.equal(init?.headers instanceof Headers ? init.headers.get(MD_TWIN_LOOP_HEADER) : null, '1');
      return new Response('<html><title>World Monitor</title><h1>Dashboard</h1><p>Live globe.</p></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });
    try {
      const res = await handler(new Request('https://www.worldmonitor.app/api/md-twin?path=dashboard'));
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/markdown/);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.match(res.headers.get('link') ?? '', /rel="canonical"/);
      assert.match(res.headers.get('link') ?? '', /rel="deprecation"/);
      const body = await res.text();
      assert.match(body, /^# /m);
      assert.match(body, /Dashboard|World Monitor/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('documents a 302 sibling as heading-led markdown', async () => {
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/download.md'),
      '/api/download.md',
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://github.com/koala73/worldmonitor/releases/latest' },
        }),
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('location'), null);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
    const body = await res.text();
    assert.match(body, /^# /m);
    assert.match(body, /github\.com\/koala73\/worldmonitor\/releases\/latest/);
  });

  it('preserves a bodyless 304 sibling', async () => {
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/dashboard.md'),
      '/dashboard.md',
      async () => new Response(null, { status: 304, headers: { etag: 'dashboard-v1' } }),
    );

    assert.equal(res.status, 304);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(await res.text(), '');
  });

  it('uses an anonymous internal identity for the sibling request', async () => {
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/latest-brief.md', {
        headers: {
          authorization: 'Bearer secret',
          cookie: 'wm_session=secret',
          'user-agent': 'Googlebot/2.1',
          'x-api-key': 'api-secret',
          'x-worldmonitor-key': 'wm-secret',
        },
      }),
      '/api/latest-brief.md',
      async (_input, init) => {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('user-agent'), 'WorldMonitor-MarkdownTwin/1.0');
        assert.equal(headers.get(MD_TWIN_LOOP_HEADER), '1');
        assert.equal(headers.get('authorization'), null);
        assert.equal(headers.get('cookie'), null);
        assert.equal(headers.get('x-api-key'), null);
        assert.equal(headers.get('x-worldmonitor-key'), null);
        return new Response('# Public brief\n');
      },
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  });

  for (const { status, headers = {}, expectedHeader, expectedValue } of [
    {
      status: 401,
      headers: { 'www-authenticate': 'Bearer realm="worldmonitor"' },
      expectedHeader: 'www-authenticate',
      expectedValue: 'Bearer realm="worldmonitor"',
    },
    { status: 403 },
    {
      status: 429,
      headers: { 'retry-after': '17' },
      expectedHeader: 'retry-after',
      expectedValue: '17',
    },
    { status: 500 },
  ]) {
    it(`preserves a ${status} sibling as a non-cacheable response`, async () => {
      const res = await buildMarkdownTwinResponse(
        new Request('https://www.worldmonitor.app/api/health.md'),
        '/api/health.md',
        async () => new Response('upstream failure', { status, headers }),
      );

      assert.equal(res.status, status);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      if (expectedHeader) assert.equal(res.headers.get(expectedHeader), expectedValue);
      assert.match(await res.text(), /^# health/m);
    });
  }

  it('rejects an oversized declared sibling body without reading it', async () => {
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/dashboard.md'),
      '/dashboard.md',
      async () => new Response('small', { headers: { 'content-length': String(MAX_TWIN_BYTES + 1) } }),
    );

    assert.equal(res.status, 502);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(await res.text(), /could not be read/);
  });

  it('cancels a streamed sibling body that exceeds the byte cap', async () => {
    let canceled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_TWIN_BYTES + 1));
      },
      cancel() {
        canceled = true;
      },
    });

    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/dashboard.md'),
      '/dashboard.md',
      async () => new Response(body),
    );

    assert.equal(res.status, 502);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(canceled, true);
  });

  it('maps sibling body-stream failures to a non-cacheable 502', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error('body failed'));
      },
    });

    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/dashboard.md'),
      '/dashboard.md',
      async () => new Response(body),
    );

    assert.equal(res.status, 502);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(await res.text(), /could not be read/);
  });

  it('uses sibling HEAD and never reads a response body', async () => {
    const unreadableBody = {
      getReader() {
        throw new Error('HEAD must not read the body');
      },
    };
    const siblingResponse = {
      body: unreadableBody,
      headers: new Headers(),
      ok: true,
      status: 200,
    };

    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/dashboard.md', { method: 'HEAD' }),
      '/dashboard.md',
      async (_input, init) => {
        assert.equal(init?.method, 'HEAD');
        return siblingResponse;
      },
    );

    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
  });

  it('does not recurse when the loop header is present', async () => {
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/dashboard.md', {
        headers: { [MD_TWIN_LOOP_HEADER]: '1' },
      }),
      '/dashboard.md',
      async () => {
        throw new Error('sibling fetch must not run');
      },
    );
    assert.equal(res.status, 404);
    assert.match(await res.text(), /^# /m);
  });
});

// Issue #7860: `/api/md-twin` answered an unbounded `.md` space with indexable,
// self-canonical 200 stubs. Root cause, verified live 2026-09-07: the
// `/:mdPath((?!api/).+).md` rewrite injects `?path=…&mdPath=…`, the handler
// copied that whole search onto the sibling fetch, and the extension-less
// sibling (`/countries/iran`) answers 308 to its trailing-slash form. With
// `redirect: 'manual'` every corpus page — real or invented — became a
// self-canonical 200 "This resource redirects to …" stub.
describe('api/md-twin.ts soft-404 farm (#7860)', () => {
  const IRAN_MARKDOWN =
    '---\ntitle: Iran Instability Index\n---\n\n# Iran Country Instability Index\n\nCII is 60/100.\n';

  /** Mirrors production: extension-less corpus paths 308 to their trailing-slash form. */
  function corpusOrigin({ trailingSlashBody = null } = {}) {
    const seen = [];
    const fetchImpl = async (input, init) => {
      const url = new URL(String(input));
      seen.push({ url, init });
      if (!url.pathname.endsWith('/')) {
        const location = new URL(url);
        location.pathname += '/';
        return new Response(null, {
          status: 308,
          headers: { location: location.pathname + location.search },
        });
      }
      if (trailingSlashBody === null) {
        return new Response('# Not found\n', {
          status: 404,
          headers: { 'content-type': 'text/markdown' },
        });
      }
      return new Response(trailingSlashBody, {
        status: 200,
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      });
    };
    return { seen, fetchImpl };
  }

  it('serves the real markdown for a corpus page instead of a redirect stub', async () => {
    const { fetchImpl } = corpusOrigin({ trailingSlashBody: IRAN_MARKDOWN });
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/md-twin?path=countries%2Firan&mdPath=countries%2Firan'),
      '/countries/iran.md',
      fetchImpl,
    );

    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Iran Country Instability Index/);
    assert.doesNotMatch(body, /This resource redirects to/);
  });

  it('returns 404 for a .md path whose sibling page does not exist', async () => {
    const { fetchImpl } = corpusOrigin();
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/md-twin?path=countries%2Fdoes-not-exist-xyz'),
      '/countries/does-not-exist-xyz.md',
      fetchImpl,
    );

    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    // Shared-cacheable on purpose. The `.md` space is unbounded and crawlers
    // probe it, so an uncacheable 404 would make every re-probe cost an origin
    // round trip — and each one fans out across the redirect chain.
    assert.equal(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=300');
  });

  it('keeps a transient upstream failure out of the shared cache', async () => {
    for (const status of [500, 502, 503, 429]) {
      const res = await buildMarkdownTwinResponse(
        new Request('https://www.worldmonitor.app/countries/iran.md'),
        '/countries/iran.md',
        async () => new Response('upstream failure', { status }),
      );

      assert.equal(res.status, status);
      assert.equal(res.headers.get('cache-control'), 'no-store', `${status} must not be cached`);
    }
  });

  it('never declares a stub the canonical representation of itself', async () => {
    const { fetchImpl } = corpusOrigin();
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/md-twin?path=countries%2Fdoes-not-exist-xyz'),
      '/countries/does-not-exist-xyz.md',
      fetchImpl,
    );

    assert.doesNotMatch(res.headers.get('link') ?? '', /rel="canonical"/);
    // Not just "no self-canonical": a 404 names no canonical at all, or the
    // body would claim a page the headers deliberately withhold.
    assert.doesNotMatch(await res.text(), /^canonical:/m);
  });

  it('points the canonical at the HTML sibling, not at the .md twin', async () => {
    const { fetchImpl } = corpusOrigin({ trailingSlashBody: IRAN_MARKDOWN });
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/md-twin?path=countries%2Firan'),
      '/countries/iran.md',
      fetchImpl,
    );

    const link = res.headers.get('link') ?? '';
    assert.match(link, /<https:\/\/www\.worldmonitor\.app\/countries\/iran\/>; rel="canonical"/);
    assert.doesNotMatch(link, /iran\.md>; rel="canonical"/);
  });

  it('asks the sibling for markdown so the negotiated body is what gets served', async () => {
    const { seen, fetchImpl } = corpusOrigin({ trailingSlashBody: IRAN_MARKDOWN });
    await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/md-twin?path=countries%2Firan'),
      '/countries/iran.md',
      fetchImpl,
    );

    assert.ok(seen.length > 1, 'the redirect hop and the resolved fetch must both be seen');
    for (const { init } of seen) {
      const headers = new Headers(init?.headers);
      assert.match(headers.get('accept') ?? '', /text\/markdown/);
      // The guard has to ride every hop, not just the first: a followed
      // redirect that lands back on a `.md` path would otherwise recurse.
      assert.equal(headers.get(MD_TWIN_LOOP_HEADER), '1');
    }
  });

  it('does not leak the rewrite-injected path/mdPath params onto the sibling', async () => {
    const { seen, fetchImpl } = corpusOrigin({ trailingSlashBody: IRAN_MARKDOWN });
    await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/md-twin?path=countries%2Firan&mdPath=countries%2Firan'),
      '/countries/iran.md',
      fetchImpl,
    );

    for (const { url } of seen) {
      assert.equal(url.searchParams.get('path'), null, `path leaked into ${url}`);
      assert.equal(url.searchParams.get('mdPath'), null, `mdPath leaked into ${url}`);
    }
  });

  // Stripping the rewrite's params must not become "strip the query string":
  // a caller's own params still have to reach the page, while the canonical
  // stays query-free so two parameterisations do not compete as documents.
  it('forwards a caller query string that is not a rewrite artifact', async () => {
    const { seen, fetchImpl } = corpusOrigin({ trailingSlashBody: IRAN_MARKDOWN });
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/md-twin?path=countries%2Firan&window=7d'),
      '/countries/iran.md',
      fetchImpl,
    );

    assert.equal(seen[0].url.searchParams.get('window'), '7d');
    assert.equal(seen[0].url.searchParams.get('path'), null);
    assert.match(
      res.headers.get('link') ?? '',
      /<https:\/\/www\.worldmonitor\.app\/countries\/iran\/>; rel="canonical"/,
    );
  });

  it('stops following same-origin redirects instead of looping forever', async () => {
    let hops = 0;
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/loop.md'),
      '/loop.md',
      async () => {
        hops += 1;
        return new Response(null, { status: 308, headers: { location: `/loop-${hops}` } });
      },
    );

    // Exact, not an upper bound: a budget that silently shrank to zero hops
    // would still satisfy `<= 4` while breaking every corpus page, all of
    // which need one hop to reach their trailing-slash form.
    assert.equal(hops, MAX_SIBLING_REDIRECTS + 1);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  it('does not throw on a Location header that will not parse', async () => {
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/countries/iran.md'),
      '/countries/iran.md',
      async () => new Response(null, { status: 308, headers: { location: 'http://[' } }),
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    assert.match(await res.text(), /redirects to/);
  });

  it('serves a body sitting exactly on the byte cap', async () => {
    const body = `# Cap\n${'x'.repeat(MAX_TWIN_BYTES - '# Cap\n'.length)}`;
    assert.equal(new TextEncoder().encode(body).byteLength, MAX_TWIN_BYTES);

    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/cap.md'),
      '/cap.md',
      async () =>
        new Response(body, {
          headers: { 'content-type': 'text/markdown', 'content-length': String(MAX_TWIN_BYTES) },
        }),
    );

    assert.equal(res.status, 200);
    assert.match(await res.text(), /^# Cap/m);
  });

  // Asking the sibling for markdown means whole documents come back, not
  // 248-byte stubs. `/sources/` is the largest corpus *page* in the sitemap —
  // measured at 132,497 bytes on 2026-09-08 — and it must survive the twin's
  // byte cap, or the fix trades a soft 200 for a hard 502 on the biggest
  // pages. (`/llms-full.txt` is larger still and stays a deliberate 502; see
  // the MAX_TWIN_BYTES comment.)
  it('serves the largest real corpus page rather than rejecting it as oversized', async () => {
    const sourcesMarkdown = `# Sources\n\n${'World Monitor tracks this source. '.repeat(4_000)}`;
    assert.ok(sourcesMarkdown.length > 132_497, 'fixture must be at least as large as the live /sources/ page');

    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/sources.md'),
      '/sources.md',
      async () =>
        new Response(sourcesMarkdown, { headers: { 'content-type': 'text/markdown; charset=utf-8' } }),
    );

    assert.equal(res.status, 200);
    assert.match(await res.text(), /^# Sources/m);
  });

  // The sibling's negotiated markdown carries front matter of its own and no
  // canonical. Before the fix `withMarkdownMetadata` returned any `---`-led
  // document untouched, so exactly where documents became real, the body
  // stopped naming the page it represents.
  it('sets the canonical in front matter the origin already wrote', async () => {
    const negotiated = '---\ndescription: Iran CII is 60/100.\ntitle: Iran\nimage: /og.png\n---\n\n# Iran\n';
    const { fetchImpl } = corpusOrigin({ trailingSlashBody: negotiated });
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/md-twin?path=countries%2Firan'),
      '/countries/iran.md',
      fetchImpl,
    );

    const block = (await res.text()).match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(block, 'the negotiated document must still carry front matter');
    assert.deepEqual(load(block[1]), {
      description: 'Iran CII is 60/100.',
      title: 'Iran',
      image: '/og.png',
      canonical: 'https://www.worldmonitor.app/countries/iran/',
    });
  });

  it('replaces a stale canonical rather than emitting the key twice', async () => {
    const stale = '---\ntitle: Iran\ncanonical: "https://www.worldmonitor.app/countries/iran.md"\n---\n\n# Iran\n';
    const { fetchImpl } = corpusOrigin({ trailingSlashBody: stale });
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/md-twin?path=countries%2Firan'),
      '/countries/iran.md',
      fetchImpl,
    );

    const document = await res.text();
    const block = document.match(/^---\n([\s\S]*?)\n---\n/);
    assert.deepEqual(load(block[1]), {
      title: 'Iran',
      canonical: 'https://www.worldmonitor.app/countries/iran/',
    });
    assert.equal(document.match(/^canonical:/gm)?.length, 1);
  });

  // One deadline for the chain, not one per hop: a fresh timeout inside the
  // loop multiplies the budget by the hop count, so slow-but-passing hops can
  // outlive the edge function itself.
  it('spends a single deadline across every redirect hop', async () => {
    const signals = [];
    await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/countries/iran.md'),
      '/countries/iran.md',
      async (input, init) => {
        signals.push(init?.signal);
        return new URL(String(input)).pathname.endsWith('/')
          ? new Response('# Iran\n', { headers: { 'content-type': 'text/markdown' } })
          : new Response(null, { status: 308, headers: { location: '/countries/iran/' } });
      },
    );

    assert.equal(signals.length, 2, 'expected one redirect hop plus the resolved fetch');
    assert.ok(signals[0], 'each hop must carry an abort signal');
    assert.equal(signals[0], signals[1], 'every hop must share one deadline');
  });

  it('follows a redirect for HEAD without reading a body', async () => {
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/countries/iran.md', { method: 'HEAD' }),
      '/countries/iran.md',
      async (input, init) => {
        assert.equal(init?.method, 'HEAD');
        return new URL(String(input)).pathname.endsWith('/')
          ? new Response(null, { status: 200, headers: { 'content-type': 'text/markdown' } })
          : new Response(null, { status: 308, headers: { location: '/countries/iran/' } });
      },
    );

    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
    assert.match(res.headers.get('link') ?? '', /<https:\/\/www\.worldmonitor\.app\/countries\/iran\/>; rel="canonical"/);
  });

  it('keeps documenting a cross-origin redirect but marks it noindex', async () => {
    const res = await buildMarkdownTwinResponse(
      new Request('https://www.worldmonitor.app/api/download.md'),
      '/api/download.md',
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://github.com/koala73/worldmonitor/releases/latest' },
        }),
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    // A redirect notice represents no page, so it names no canonical in either
    // half — `noindex` alongside a canonical would be two contradictory claims.
    assert.doesNotMatch(res.headers.get('link') ?? '', /rel="canonical"/);
    const body = await res.text();
    assert.doesNotMatch(body, /^canonical:/m);
    assert.match(body, /github\.com\/koala73\/worldmonitor\/releases\/latest/);
  });
});
