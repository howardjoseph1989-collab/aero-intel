/**
 * AERO GEMINI turn broker — Google AI Studio generateContent proxy.
 *
 * POST /api/aero-gemini
 *   Body: { text?, audio?, mimeType?, toolResults?, history?, dashboardContext?, speak? }
 * GET  /api/aero-gemini  — availability + model (never returns the key)
 *
 * The Gemini API envelope is dictated by Google generateContent, not a product proto.
 */

export const config = { runtime: 'edge', regions: ['iad1', 'lhr1', 'fra1', 'sfo1'] };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { CHROME_UA } from '../server/_shared/constants';
import {
  checkScopedRateLimit,
  ENDPOINT_RATE_POLICIES,
  getClientIp,
  scopedTooManyRequestsResponse,
} from '../server/_shared/rate-limit';
import {
  geminiVoiceStatus,
  runGeminiTurn,
} from '../server/_shared/aero-gemini-broker';
import { AERO_GEMINI_TOOL_SPECS } from '../shared/aero-gemini-tools';

const RATE_LIMIT_SCOPE = '/api/aero-gemini';
const RATE_LIMIT_POLICY = ENDPOINT_RATE_POLICIES[RATE_LIMIT_SCOPE];
if (!RATE_LIMIT_POLICY) {
  throw new Error(
    `[aero-gemini] missing ENDPOINT_RATE_POLICIES['${RATE_LIMIT_SCOPE}'] — see server/_shared/rate-limit.ts`,
  );
}
const RATE_LIMIT_MAX = RATE_LIMIT_POLICY.limit;
const RATE_LIMIT_WINDOW = RATE_LIMIT_POLICY.window;

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...cors,
    },
  });
}

async function enforceRateLimit(req: Request, cors: Record<string, string>): Promise<Response | null> {
  const result = await checkScopedRateLimit(
    RATE_LIMIT_SCOPE,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW,
    getClientIp(req),
  );
  if (!result.allowed) return scopedTooManyRequestsResponse(result, RATE_LIMIT_WINDOW, cors);
  return null;
}

export default async function handler(req: Request): Promise<Response> {
  const cors = getCorsHeaders(req) as Record<string, string>;
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (isDisallowedOrigin(req)) {
    return json({ error: 'Origin not allowed' }, 403, cors);
  }

  const limited = await enforceRateLimit(req, cors);
  if (limited) return limited;

  const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GEMINI_VOICE_MODEL: process.env.GEMINI_VOICE_MODEL,
    GEMINI_TTS_MODEL: process.env.GEMINI_TTS_MODEL,
  };

  if (req.method === 'GET') {
    return json(geminiVoiceStatus(env, AERO_GEMINI_TOOL_SPECS.length), 200, cors);
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { ...cors, Allow: 'GET, POST, OPTIONS' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400, cors);
  }

  const result = await runGeminiTurn({
    env,
    body,
    tools: AERO_GEMINI_TOOL_SPECS,
    userAgent: `AERO-INTEL-Gemini/1.0 (${CHROME_UA})`,
  });
  return json(result.payload, result.status, cors);
}
