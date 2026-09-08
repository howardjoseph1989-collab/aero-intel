/**
 * Generic markdown URL-fallback handler.
 *
 * Vercel afterFiles rewrites unmatched `/{page}.md` (except static files,
 * /docs/*, /index.md, and /api/*) here. The handler fetches the sibling page
 * and returns its markdown, so agent-readiness scanners that probe content
 * URLs get a real .md twin rather than a JSON/HTML body.
 *
 * The rewrite's path space is unbounded, so the twin only ever mirrors what
 * the sibling actually answers: a path with no page behind it returns the
 * origin's 404, and no twin canonicalises to itself. Returning cheap,
 * cacheable, self-canonical 200 stubs for invented paths made this route a
 * soft-404 farm against an already-binding crawl budget (#7860).
 */

import {
  buildMarkdownTwinResponse,
  resolveMarkdownTwinPath,
} from './_md-url-twin';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const markdownPath = resolveMarkdownTwinPath(req);
  if (!markdownPath) {
    return new Response('# Not found\n\nNo markdown twin path was provided.\n', {
      status: 404,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
  return buildMarkdownTwinResponse(req, markdownPath);
}
