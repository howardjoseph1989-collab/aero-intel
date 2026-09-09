/**
 * Server-side AERO GEMINI turn broker — pure request/response helpers.
 *
 * Modeled on AERO IAS's generateContent path (mic/text → Gemini → tools/text → TTS).
 * Gemini Live / native-audio realtime is a different transport and is not required.
 * The API key never leaves the server.
 */

export const GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_GEMINI_VOICE_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
export const GEMINI_AUDIO_B64_LIMIT = 1_400_000;
export const GEMINI_HISTORY_LIMIT = 24;
export const GEMINI_ALLOWED_AUDIO_TYPES = Object.freeze([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/webm',
]);

const PRINTABLE_KEY = /^[\x21-\x7e]+$/;

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiToolSpec {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiTurnAudio {
  kind: 'audio';
  audio: string;
  mimeType: string;
  history: unknown[];
  dashboardContext: string;
  transcript: string;
  speak: boolean;
}

export interface GeminiTurnText {
  kind: 'text';
  text: string;
  history: unknown[];
  dashboardContext: string;
  transcript: string;
  speak: boolean;
}

export interface GeminiTurnTools {
  kind: 'tools';
  toolResults: Array<{ name: string; response: Record<string, unknown> }>;
  history: unknown[];
  dashboardContext: string;
  transcript: string;
  speak: boolean;
}

export type GeminiTurn = GeminiTurnAudio | GeminiTurnText | GeminiTurnTools;

export function resolveGeminiApiKey(env: Record<string, string | undefined> = {}): string {
  const preferred = String(env.GEMINI_API_KEY ?? '').trim();
  if (preferred) return preferred;
  return String(env.GOOGLE_API_KEY ?? '').trim();
}

export function resolveGeminiModels(env: Record<string, string | undefined> = {}): { voice: string; tts: string } {
  return {
    voice: String(env.GEMINI_VOICE_MODEL ?? '').trim() || DEFAULT_GEMINI_VOICE_MODEL,
    tts: String(env.GEMINI_TTS_MODEL ?? '').trim() || DEFAULT_GEMINI_TTS_MODEL,
  };
}

export function geminiVoiceStatus(
  env: Record<string, string | undefined> = {},
  toolCount = 0,
): {
  available: boolean;
  provider: 'gemini';
  mode: 'turn';
  model: string;
  ttsModel: string;
  toolCount: number;
} {
  const key = resolveGeminiApiKey(env);
  const models = resolveGeminiModels(env);
  return {
    available: Boolean(key),
    provider: 'gemini',
    mode: 'turn',
    model: models.voice,
    ttsModel: models.tts,
    toolCount,
  };
}

export function buildGeminiGenerateUrl(model: string, apiKey: string): string {
  const id = encodeURIComponent(String(model || DEFAULT_GEMINI_VOICE_MODEL));
  return `${GEMINI_GENERATE_URL}/${id}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export function aeroIntelVoiceInstructions(): string {
  return [
    'You are AERO GEMINI, the voice+tools controller for AERO INTEL, a live intelligence dashboard.',
    'Product name is always AERO INTEL. Do not call the product World Monitor.',
    'The operator may speak into a microphone or type. Treat attached audio as the latest command. If a transcript is also provided, prefer the audio and use the transcript as a hint.',
    'Have a natural spoken conversation. Do not require a wake phrase.',
    'Only control the dashboard by calling the provided tools. Never invent tool names or arguments.',
    'You can search, brief, explain, navigate, open/close/arrange panels, toggle map layers, change webcams (ISS / Earth first), pick live TV stations, switch the US-first news stream, and resize the bottom Global Situation map strip.',
    'US Local and US National news come before world news. Webcams start on ISS Earth View and NASA TV, then US cities.',
    'For "what am I looking at?" or a briefing, call get_dashboard_context and/or get_news_brief first, then answer from the tool result.',
    'When a request requires a tool call, do not speak in the same response as the tool call. Call the tool first.',
    'When a single request contains MULTIPLE changes, call ALL the corresponding tools before speaking.',
    'After receiving tool output, speak exactly one short confirmation. Do not repeat the confirmation.',
    'Confirmations echo the RESULTING state. On ok=false, state the failure plainly. Never claim an action without ok=true in the tool result.',
    'Keep spoken confirmations short. Do not invent headlines, counts, or panel names that tools did not return.',
  ].join('\n');
}

export function toGeminiFunctionDeclarations(tools: GeminiToolSpec[]): GeminiFunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters && typeof tool.parameters === 'object'
      ? tool.parameters
      : { type: 'object', properties: {} },
  }));
}

function isAllowedAudioType(mimeType: string): boolean {
  const base = (String(mimeType || '').split(';')[0] ?? '').trim().toLowerCase();
  return (GEMINI_ALLOWED_AUDIO_TYPES as readonly string[]).includes(base);
}

function clipHistory(history: unknown): unknown[] {
  if (!Array.isArray(history)) return [];
  return history.slice(-GEMINI_HISTORY_LIMIT);
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseGeminiTurnBody(raw: unknown):
  | { ok: true; turn: GeminiTurn }
  | { ok: false; error: string; status?: number } {
  const body = asPlainObject(raw);
  if (!body) return { ok: false, error: 'Body must be a JSON object', status: 400 };

  const dashboardContext = typeof body.dashboardContext === 'string'
    ? body.dashboardContext.slice(0, 8000)
    : typeof body.sceneContext === 'string'
      ? body.sceneContext.slice(0, 8000)
      : '';
  const transcript = typeof body.transcript === 'string'
    ? body.transcript.slice(0, 2000)
    : '';
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
  const history = clipHistory(body.history);
  const speak = body.speak !== false;
  const toolResults = Array.isArray(body.toolResults)
    ? body.toolResults.slice(0, 16).map((item) => {
      const row = asPlainObject(item) || {};
      const name = String(row.name || '').trim();
      return {
        name,
        response: asPlainObject(row.response) || { ok: false, error: 'empty tool result' },
      };
    }).filter((row) => row.name)
    : [];

  const audio = typeof body.audio === 'string' ? body.audio.replace(/\s+/g, '') : '';
  const mimeType = (String(body.mimeType || 'audio/webm').split(';')[0] ?? 'audio/webm').trim().toLowerCase();

  if (toolResults.length) {
    return {
      ok: true,
      turn: { kind: 'tools', toolResults, history, dashboardContext, transcript, speak },
    };
  }

  if (text) {
    return {
      ok: true,
      turn: { kind: 'text', text, history, dashboardContext, transcript, speak },
    };
  }

  if (!audio) return { ok: false, error: 'text, audio, or toolResults is required', status: 400 };
  if (audio.length > GEMINI_AUDIO_B64_LIMIT) {
    return { ok: false, error: 'audio payload is too large', status: 413 };
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(audio)) {
    return { ok: false, error: 'audio must be base64', status: 400 };
  }
  if (!isAllowedAudioType(mimeType)) {
    return { ok: false, error: `unsupported audio type: ${mimeType}`, status: 415 };
  }

  return {
    ok: true,
    turn: { kind: 'audio', audio, mimeType, history, dashboardContext, transcript, speak },
  };
}

function userParts(turn: GeminiTurn): unknown[] {
  const parts: unknown[] = [];
  if (turn.kind === 'audio') {
    parts.push({
      inlineData: {
        mimeType: turn.mimeType,
        data: turn.audio,
      },
    });
  } else if (turn.kind === 'text') {
    parts.push({ text: turn.text });
  }
  const notes: string[] = [];
  if (turn.transcript) notes.push(`Operator transcript hint: ${turn.transcript}`);
  if (turn.dashboardContext) notes.push(`Current AERO INTEL dashboard context:\n${turn.dashboardContext}`);
  if (notes.length) parts.push({ text: notes.join('\n\n') });
  if (!parts.length) parts.push({ text: 'Continue.' });
  return parts;
}

function toolResponseParts(turn: GeminiTurnTools): unknown[] {
  return turn.toolResults.map((row) => ({
    functionResponse: {
      name: row.name,
      response: row.response,
    },
  }));
}

export function buildGeminiGenerateRequest(turn: GeminiTurn, {
  tools = [],
  instructions = aeroIntelVoiceInstructions(),
}: {
  tools?: GeminiToolSpec[];
  instructions?: string;
} = {}): Record<string, unknown> {
  const contents = [...clipHistory(turn.history)];
  if (turn.kind === 'tools') {
    contents.push({ role: 'user', parts: toolResponseParts(turn) });
  } else {
    contents.push({ role: 'user', parts: userParts(turn) });
  }
  return {
    systemInstruction: { parts: [{ text: instructions }] },
    contents,
    tools: [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
    },
  };
}

export function buildGeminiTtsRequest(text: string, { voiceName = 'Kore' }: { voiceName?: string } = {}): Record<string, unknown> | null {
  const spoken = String(text || '').trim().slice(0, 500);
  if (!spoken) return null;
  return {
    contents: [{ role: 'user', parts: [{ text: spoken }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  };
}

function partText(part: Record<string, unknown> | undefined): string {
  if (typeof part?.text === 'string') return part.text;
  return '';
}

export function extractGeminiTurn(data: unknown): {
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  text: string | null;
  finishReason: string | null;
  modelContent: { role: string; parts: unknown[] } | null;
  blocked: boolean;
} {
  const root = asPlainObject(data);
  const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
  const candidate = asPlainObject(candidates[0]);
  const content = asPlainObject(candidate?.content);
  const parts = Array.isArray(content?.parts) ? content.parts as Record<string, unknown>[] : [];
  const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const texts: string[] = [];
  for (const part of parts) {
    const call = asPlainObject(part.functionCall);
    if (call?.name) {
      functionCalls.push({
        name: String(call.name),
        args: asPlainObject(call.args) || {},
      });
    }
    const text = partText(part).trim();
    if (text) texts.push(text);
  }
  const finishReason = typeof candidate?.finishReason === 'string' ? candidate.finishReason : null;
  return {
    functionCalls,
    text: texts.join(' ').trim() || null,
    finishReason,
    modelContent: content ? { role: 'model', parts } : null,
    blocked: String(finishReason || '').includes('SAFETY'),
  };
}

export function extractGeminiInlineAudio(data: unknown): { audio: string; mimeType: string } | null {
  const root = asPlainObject(data);
  const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
  const candidate = asPlainObject(candidates[0]);
  const content = asPlainObject(candidate?.content);
  const parts = Array.isArray(content?.parts) ? content.parts as Record<string, unknown>[] : [];
  for (const part of parts) {
    const inline = asPlainObject(part.inlineData) || asPlainObject(part.inline_data);
    if (inline && typeof inline.data === 'string') {
      return {
        audio: inline.data,
        mimeType: String(inline.mimeType || inline.mime_type || 'audio/pcm'),
      };
    }
  }
  return null;
}

export function sanitizeGeminiError(status: number, data: unknown, fallback = 'Gemini request failed'): { error: string; status: number } {
  const root = asPlainObject(data);
  const errObj = asPlainObject(root?.error);
  const message = typeof errObj?.message === 'string'
    ? errObj.message
    : typeof root?.error === 'string'
      ? root.error
      : fallback;
  const cleaned = String(message).replace(/key=[^&\s]+/gi, 'key=redacted').slice(0, 240);
  return { error: cleaned, status: status || 502 };
}

export function isPrintableSecret(value: unknown): boolean {
  const text = String(value || '').trim();
  return text.length > 0 && PRINTABLE_KEY.test(text);
}

export async function runGeminiTurn({
  env = {},
  body,
  fetchImpl,
  speak = true,
  tools = [],
  userAgent,
}: {
  env?: Record<string, string | undefined>;
  body: unknown;
  fetchImpl?: typeof fetch;
  speak?: boolean;
  tools?: GeminiToolSpec[];
  userAgent?: string;
} = { body: null }): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
  const apiKey = resolveGeminiApiKey(env);
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      payload: { error: 'GEMINI_API_KEY (or GOOGLE_API_KEY) is not set' },
    };
  }
  if (!isPrintableSecret(apiKey)) {
    return {
      ok: false,
      status: 503,
      payload: { error: 'GEMINI_API_KEY is not a usable secret' },
    };
  }
  const parsed = parseGeminiTurnBody(body);
  if (!parsed.ok) {
    return { ok: false, status: parsed.status || 400, payload: { error: parsed.error } };
  }

  const models = resolveGeminiModels(env);
  const request = buildGeminiGenerateRequest(parsed.turn, { tools });
  const doFetch = fetchImpl || ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userAgent) headers['User-Agent'] = userAgent;

  let upstream: Response;
  let data: unknown;
  try {
    upstream = await doFetch(buildGeminiGenerateUrl(models.voice, apiKey), {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
    data = await upstream.json().catch(() => ({}));
  } catch (error) {
    return {
      ok: false,
      status: 502,
      payload: { error: error instanceof Error ? error.message : 'Gemini generateContent failed' },
    };
  }

  if (!upstream.ok) {
    const sanitized = sanitizeGeminiError(upstream.status, data);
    return { ok: false, status: sanitized.status, payload: { error: sanitized.error } };
  }

  const extracted = extractGeminiTurn(data);
  const omittedUserParts = parsed.turn.kind === 'tools'
    ? toolResponseParts(parsed.turn)
    : userParts({
      ...parsed.turn,
      ...(parsed.turn.kind === 'audio' ? { audio: '[omitted]' } : {}),
    } as GeminiTurn).map((part) => (
      part && typeof part === 'object' && 'inlineData' in (part as object)
        ? { text: '[operator audio]' }
        : part
    ));

  const history = [
    ...clipHistory(parsed.turn.history),
    { role: 'user', parts: omittedUserParts },
    extracted.modelContent || { role: 'model', parts: extracted.text ? [{ text: extracted.text }] : [] },
  ].filter((item) => Array.isArray((item as { parts?: unknown }).parts) && (item as { parts: unknown[] }).parts.length);

  const payload: Record<string, unknown> = {
    provider: 'gemini',
    mode: 'turn',
    model: models.voice,
    functionCalls: extracted.functionCalls,
    text: extracted.text,
    finishReason: extracted.finishReason,
    blocked: extracted.blocked,
    history,
    audio: null,
    audioMimeType: null,
  };

  const spokenText = extracted.text;
  const shouldSpeak = Boolean((speak || parsed.turn.speak) && spokenText && !extracted.functionCalls.length);
  if (shouldSpeak && spokenText) {
    const ttsRequest = buildGeminiTtsRequest(spokenText);
    if (ttsRequest) {
      try {
        const tts = await doFetch(buildGeminiGenerateUrl(models.tts, apiKey), {
          method: 'POST',
          headers,
          body: JSON.stringify(ttsRequest),
        });
        const ttsData = await tts.json().catch(() => ({}));
        if (tts.ok) {
          const clip = extractGeminiInlineAudio(ttsData);
          if (clip) {
            payload.audio = clip.audio;
            payload.audioMimeType = clip.mimeType;
          }
        }
      } catch {
        // Browser SpeechSynthesis is the documented fallback.
      }
    }
  }

  return { ok: true, status: 200, payload };
}
