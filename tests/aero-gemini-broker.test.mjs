import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aeroIntelVoiceInstructions,
  extractGeminiTurn,
  parseGeminiTurnBody,
  resolveGeminiApiKey,
  runGeminiTurn,
  sanitizeGeminiError,
} from '../server/_shared/aero-gemini-broker.ts';
import { AERO_GEMINI_TOOL_SPECS } from '../shared/aero-gemini-tools.ts';

describe('AERO GEMINI broker', () => {
  it('prefers GEMINI_API_KEY over GOOGLE_API_KEY and never treats empty as set', () => {
    assert.equal(resolveGeminiApiKey({ GEMINI_API_KEY: ' studio-key ', GOOGLE_API_KEY: 'other' }), 'studio-key');
    assert.equal(resolveGeminiApiKey({ GOOGLE_API_KEY: 'alias' }), 'alias');
    assert.equal(resolveGeminiApiKey({}), '');
  });

  it('parses text, audio, and toolResults turns', () => {
    const text = parseGeminiTurnBody({ text: 'Brief me', dashboardContext: 'US Local' });
    assert.equal(text.ok, true);
    if (text.ok) assert.equal(text.turn.kind, 'text');

    const audio = parseGeminiTurnBody({ audio: Buffer.from('abc').toString('base64'), mimeType: 'audio/webm' });
    assert.equal(audio.ok, true);
    if (audio.ok) assert.equal(audio.turn.kind, 'audio');

    const tools = parseGeminiTurnBody({
      toolResults: [{ name: 'get_news_brief', response: { ok: true, titles: ['One'] } }],
    });
    assert.equal(tools.ok, true);
    if (tools.ok) assert.equal(tools.turn.kind, 'tools');
  });

  it('rejects missing payload and sanitizes leaked keys in upstream errors', () => {
    const missing = parseGeminiTurnBody({});
    assert.equal(missing.ok, false);
    const cleaned = sanitizeGeminiError(400, { error: { message: 'bad key=AIzaSySecret123 in url' } });
    assert.match(cleaned.error, /key=redacted/);
    assert.doesNotMatch(cleaned.error, /AIzaSySecret123/);
  });

  it('extracts function calls from generateContent candidates', () => {
    const extracted = extractGeminiTurn({
      candidates: [{
        content: {
          role: 'model',
          parts: [{ functionCall: { name: 'get_news_brief', args: { hierarchy: 'us-local' } } }],
        },
        finishReason: 'STOP',
      }],
    });
    assert.equal(extracted.functionCalls[0]?.name, 'get_news_brief');
    assert.equal(extracted.functionCalls[0]?.args.hierarchy, 'us-local');
  });

  it('instructions name AERO INTEL and cover dashboard tools', () => {
    const text = aeroIntelVoiceInstructions();
    assert.match(text, /AERO INTEL/);
    assert.doesNotMatch(text, /World Monitor/);
    assert.match(text, /get_news_brief/);
    assert.ok(AERO_GEMINI_TOOL_SPECS.some((tool) => tool.name === 'set_webcam_view'));
    assert.ok(AERO_GEMINI_TOOL_SPECS.some((tool) => tool.name === 'set_global_situation_height'));
  });

  it('returns 503 when no Google AI Studio key is configured', async () => {
    const result = await runGeminiTurn({
      env: {},
      body: { text: 'hello' },
      tools: AERO_GEMINI_TOOL_SPECS,
    });
    assert.equal(result.status, 503);
    assert.match(String(result.payload.error), /GEMINI_API_KEY/);
  });
});
