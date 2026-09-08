/**
 * Markdown URL-fallback twins for agent-readiness scanners.
 *
 * The protocol is site-wide: GET /{page} has a twin at GET /{page}.md with
 * text/markdown (or a heading-led non-HTML body). Static files under public/
 * win. Everything else is generated from the sibling URL.
 *
 * The twin mirrors the sibling and never invents a page. It asks the origin
 * for `text/markdown`, follows same-origin redirects to whatever finally
 * answers, and reports that response's status. A path with no page behind it
 * therefore 404s. Only a served document gets a canonical, and it points at
 * the sibling — never at the `.md` URL, which would set a stub competing with
 * the page it summarises (#7860).
 *
 * Loop-prevention: sibling fetches send x-wm-md-twin so a .md handler never
 * fetches another .md handler.
 */

// @ts-expect-error — JS module, no declaration file
import { getPublicCorsHeaders } from './_cors.js';
import { appendDeprecationPolicyLinkToRecord, DEPRECATION_POLICY_LINK } from '../server/_shared/deprecation-policy';

export const MD_TWIN_LOOP_HEADER = 'x-wm-md-twin';
/**
 * The ceiling has to clear the real corpus, not just the old stubs. Once the
 * twin asks for `text/markdown` (#7860) it receives whole documents: measured
 * across all 273 sitemap URLs on 2026-09-08 the largest is `/sources/` at
 * 132,497 bytes, then `/countries/` at 105,932. At the previous 80 KB cap both
 * would have answered 502 where they used to answer a stub. 256 KB keeps ~2x
 * headroom over the largest page while still bounding what the edge buffers.
 */
export const MAX_TWIN_BYTES = 256_000;
const MAX_TWIN_CHARS = MAX_TWIN_BYTES;
const SIBLING_FETCH_TIMEOUT_MS = 8_000;
const SIBLING_USER_AGENT = 'WorldMonitor-MarkdownTwin/1.0';
/**
 * `text/markdown` leads because the origin negotiates a real markdown variant
 * of every corpus page under that Accept; the rest are the fallbacks the
 * converters below can still turn into a heading-led document (#7860).
 */
const SIBLING_ACCEPT =
  'text/markdown, text/html;q=0.9, application/json;q=0.8, text/plain;q=0.7, */*;q=0.1';
/**
 * Vercel's `/:mdPath((?!api/).+).md` rewrite injects these. They are routing
 * artifacts, never caller intent, so they must not reach the sibling.
 */
const REWRITE_SYNTHETIC_PARAMS = ['path', 'mdPath'] as const;
/**
 * Corpus pages answer 308 from `/x` to `/x/`. Following that hop is what turns
 * a soft-404 stub into the real document — or into the origin's honest 404.
 */
const MAX_SIBLING_REDIRECTS = 3;
const FORWARDED_RESPONSE_HEADERS = [
  'allow',
  'location',
  'retry-after',
  'www-authenticate',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
] as const;

export function isMarkdownTwinPath(pathname: string): boolean {
  return (
    pathname.startsWith('/') &&
    pathname.endsWith('.md') &&
    pathname.length > 4 &&
    !pathname.includes('..') &&
    !pathname.includes('//') &&
    !pathname.includes('\\')
  );
}

export function siblingPathFromMarkdown(markdownPath: string): string | null {
  if (!isMarkdownTwinPath(markdownPath)) return null;
  if (markdownPath.startsWith('/api/md-twin')) return null;
  const sibling = markdownPath.slice(0, -3);
  return sibling.length > 0 ? sibling : null;
}

export function sanitizeMarkdownTwinPath(raw: string): string | null {
  let candidate = raw.trim();
  if (!candidate.startsWith('/')) candidate = `/${candidate}`;
  if (!candidate.endsWith('.md')) candidate += '.md';
  if (!isMarkdownTwinPath(candidate)) return null;
  if (candidate.startsWith('/api/md-twin')) return null;
  return candidate;
}

export function resolveMarkdownTwinPath(req: Request): string | null {
  const url = new URL(req.url);
  const pathname = url.pathname;
  if (pathname === '/api/md-twin' || pathname === '/api/md-twin/') {
    const queryPath = url.searchParams.get('path') ?? url.searchParams.get('mdPath');
    if (!queryPath || queryPath === '$1') return null;
    return sanitizeMarkdownTwinPath(queryPath);
  }
  if (isMarkdownTwinPath(pathname)) return pathname;
  return null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n >= 32 ? String.fromCharCode(n) : '';
    });
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

export function htmlToMarkdown(html: string, fallbackTitle: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripTags(titleMatch?.[1] ?? '') || fallbackTitle;

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  const main = body.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? body;

  let text = main
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_m, inner: string) => `\n\n# ${stripTags(inner)}\n\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_m, inner: string) => `\n\n## ${stripTags(inner)}\n\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_m, inner: string) => `\n\n### ${stripTags(inner)}\n\n`)
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_m, inner: string) => `\n\n#### ${stripTags(inner)}\n\n`)
    .replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, (_m, inner: string) => `\n\n##### ${stripTags(inner)}\n\n`)
    .replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, (_m, inner: string) => `\n\n###### ${stripTags(inner)}\n\n`)
    .replace(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href: string, inner: string) => {
        const label = stripTags(inner) || href;
        return `[${label}](${href})`;
      },
    )
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${stripTags(inner)}`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  text = decodeHtmlEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (!/^# /m.test(text)) {
    text = text.length > 0 ? `# ${title}\n\n${text}` : `# ${title}`;
  }

  return text.slice(0, MAX_TWIN_CHARS);
}

function jsonToMarkdown(raw: string, heading: string): string {
  let pretty = raw.trim();
  try {
    pretty = JSON.stringify(JSON.parse(raw) as unknown, null, 2);
  } catch {
    // Keep the original text when the body is not JSON.
  }
  return `# ${heading}\n\n\`\`\`json\n${pretty}\n\`\`\``.slice(0, MAX_TWIN_CHARS);
}

function withMarkdownMetadata(markdown: string, canonical: string): string {
  if (markdown.startsWith('---\n')) return markdown;
  const title = markdown.match(/^# (.+)$/m)?.[1] ?? headingFromPath(new URL(canonical).pathname);
  return `---\ntitle: ${JSON.stringify(title)}\ncanonical: ${JSON.stringify(canonical)}\n---\n\n${markdown}`;
}

/**
 * `canonical` is the HTML sibling the twin represents, or null when the twin
 * has no document behind it. A twin never canonicalises to itself: a 248-byte
 * `.md` stub claiming to be the canonical representation of a country page is
 * exactly what made this route a soft-404 farm (#7860). Pass null for anything
 * that is not a served document; those responses carry `X-Robots-Tag: noindex`
 * instead, so an unbounded `.md` space costs no crawl budget.
 */
function markdownHeaders(
  canonical: string | null,
  extra: Record<string, string> = {},
): Record<string, string> {
  const links = canonical
    ? `<${canonical}>; rel="canonical", ${DEPRECATION_POLICY_LINK}`
    : DEPRECATION_POLICY_LINK;
  return {
    'Content-Type': 'text/markdown; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=3600',
    // The loop-guard header is the only request header that changes the twin
    // response (loop requests get a 404 stub). CORS is `*` (no Origin echo),
    // the outbound Accept is fixed, and auth/cookie/UA are never forwarded, so
    // no other variance needs declaring.
    Vary: MD_TWIN_LOOP_HEADER,
    ...getPublicCorsHeaders('GET, HEAD, OPTIONS'),
    Link: links,
    ...extra,
  };
}

/** Headers for a twin with no indexable document behind it. */
function nonDocumentHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return markdownHeaders(null, { 'X-Robots-Tag': 'noindex', ...extra });
}

/**
 * The sibling URL to fetch, with the rewrite's synthetic params removed. A
 * caller's own query string still rides along — `/countries/iran.md?window=7d`
 * must reach the same page state the HTML request would.
 */
function siblingRequestUrl(req: Request, sibling: string): URL {
  const requestUrl = new URL(req.url);
  const search = new URLSearchParams(requestUrl.search);
  if (requestUrl.pathname === '/api/md-twin' || requestUrl.pathname === '/api/md-twin/') {
    for (const name of REWRITE_SYNTHETIC_PARAMS) search.delete(name);
  }
  const siblingUrl = new URL(sibling, req.url);
  siblingUrl.search = search.toString();
  return siblingUrl;
}

function headingFromPath(pathname: string): string {
  const leaf = pathname.split('/').filter(Boolean).pop() ?? pathname;
  return leaf.replace(/[-_]+/g, ' ');
}

async function readSiblingBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TWIN_BYTES) {
    try {
      void response.body?.cancel('Sibling response exceeds the markdown twin byte limit').catch(() => {});
    } catch {
      // The declared size is already enough to reject the response.
    }
    throw new Error('Sibling response exceeds the markdown twin byte limit');
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_TWIN_BYTES) {
        try {
          void reader.cancel('Sibling response exceeds the markdown twin byte limit').catch(() => {});
        } catch {
          // The stream may already be errored; the size failure is authoritative.
        }
        throw new Error('Sibling response exceeds the markdown twin byte limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function forwardedResponseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

export async function buildMarkdownTwinResponse(
  req: Request,
  markdownPath: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const corsHeaders = getPublicCorsHeaders('GET, HEAD, OPTIONS');

  if (req.method === 'OPTIONS') {
    appendDeprecationPolicyLinkToRecord(corsHeaders);
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('# Method not allowed\n', {
      status: 405,
      headers: nonDocumentHeaders({ Allow: 'GET, HEAD, OPTIONS' }),
    });
  }

  if (req.headers.get(MD_TWIN_LOOP_HEADER) === '1') {
    return new Response('# Not found\n', {
      status: 404,
      headers: nonDocumentHeaders({ 'Cache-Control': 'no-store' }),
    });
  }

  const sibling = siblingPathFromMarkdown(markdownPath);
  if (!sibling) {
    return new Response('# Not found\n', {
      status: 404,
      headers: nonDocumentHeaders({ 'Cache-Control': 'no-store' }),
    });
  }

  const outbound = new Headers();
  outbound.set('user-agent', SIBLING_USER_AGENT);
  outbound.set(MD_TWIN_LOOP_HEADER, '1');
  outbound.set('accept', SIBLING_ACCEPT);

  // Resolve the sibling by hand rather than with `redirect: 'follow'` so a
  // cross-origin hop stays a document instead of being fetched, and so the
  // canonical tracks the URL that actually answered.
  let siblingUrl = siblingRequestUrl(req, sibling);
  let siblingRes: Response;
  let followed = 0;
  for (;;) {
    try {
      siblingRes = await fetchImpl(siblingUrl, {
        method: req.method,
        headers: outbound,
        redirect: 'manual',
        signal: AbortSignal.timeout(SIBLING_FETCH_TIMEOUT_MS),
      });
    } catch {
      return new Response(
        `# ${headingFromPath(sibling)}\n\nThe sibling page at \`${sibling}\` could not be fetched.\n`,
        { status: 502, headers: nonDocumentHeaders({ 'Cache-Control': 'no-store' }) },
      );
    }

    const location = siblingRes.headers.get('location');
    if (siblingRes.status < 300 || siblingRes.status >= 400 || !location) break;

    let target: URL | null = null;
    try {
      target = new URL(location, siblingUrl);
    } catch {
      target = null;
    }

    // A cross-origin hop is the destination, not a step towards one — the twin
    // documents it rather than fetching another site on the caller's behalf.
    if (!target || target.origin !== siblingUrl.origin) {
      void siblingRes.body?.cancel().catch(() => {});
      const body = `# ${headingFromPath(sibling)}\n\nThis resource redirects to [${location}](${location}).\n`;
      const canonical = new URL(sibling, req.url).href;
      return new Response(req.method === 'HEAD' ? null : withMarkdownMetadata(body, canonical), {
        status: 200,
        headers: markdownHeaders(canonical, { 'X-Robots-Tag': 'noindex' }),
      });
    }

    if (followed >= MAX_SIBLING_REDIRECTS) {
      // An unresolvable chain has no document behind it. Answering 404 keeps
      // the `.md` space bounded instead of minting another cacheable 200.
      void siblingRes.body?.cancel().catch(() => {});
      return new Response(`# ${headingFromPath(sibling)}\n\nNot found.\n`, {
        status: 404,
        headers: nonDocumentHeaders({ 'Cache-Control': 'no-store' }),
      });
    }

    void siblingRes.body?.cancel().catch(() => {});
    siblingUrl = target;
    followed += 1;
  }

  // Whatever finally answered is the page this twin represents, so it — never
  // the `.md` URL — is the canonical (#7860).
  const canonical = new URL(siblingUrl.pathname, req.url).href;
  const isFailure = !siblingRes.ok;
  const siblingStatus = isFailure ? siblingRes.status : 200;
  const responseHeaders: Record<string, string> = {
    ...(isFailure ? { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } : {}),
    ...forwardedResponseHeaders(siblingRes),
  };
  const documentHeaders = (extra: Record<string, string>) =>
    isFailure ? nonDocumentHeaders(extra) : markdownHeaders(canonical, extra);

  if (req.method === 'HEAD') {
    return new Response(null, {
      status: siblingStatus,
      headers: documentHeaders(responseHeaders),
    });
  }

  if (siblingStatus === 304) {
    return new Response(null, {
      status: siblingStatus,
      headers: documentHeaders(responseHeaders),
    });
  }

  const heading = headingFromPath(sibling);
  let markdown: string;
  try {
    const contentType = siblingRes.headers.get('content-type') ?? '';
    const raw = await readSiblingBody(siblingRes);

    if (/markdown|text\/plain/i.test(contentType) && /^# /m.test(raw)) {
      markdown = raw.slice(0, MAX_TWIN_CHARS);
    } else if (/json/i.test(contentType) || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
      markdown = jsonToMarkdown(raw, heading);
    } else if (/html/i.test(contentType) || /<html|<body|<title/i.test(raw)) {
      markdown = htmlToMarkdown(raw, heading);
    } else if (raw.trim().length === 0) {
      markdown = `# ${heading}\n`;
    } else {
      markdown = /^# /m.test(raw) ? raw.slice(0, MAX_TWIN_CHARS) : `# ${heading}\n\n${raw}`.slice(0, MAX_TWIN_CHARS);
    }

    if (!/^# /m.test(markdown)) {
      markdown = `# ${heading}\n\n${markdown}`;
    }
  } catch {
    return new Response(`# ${heading}\n\nThe sibling page at \`${sibling}\` could not be read.\n`, {
      status: 502,
      headers: nonDocumentHeaders({ 'Cache-Control': 'no-store' }),
    });
  }

  return new Response(withMarkdownMetadata(markdown, canonical), {
    status: siblingStatus,
    headers: documentHeaders(responseHeaders),
  });
}
