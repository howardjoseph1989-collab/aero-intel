import {
  dashboardContextForGemini,
  executeAeroGeminiTool,
} from '@/services/aero-gemini-actions';

interface GeminiTurnResponse {
  error?: string;
  text?: string | null;
  functionCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  history?: unknown[];
  audio?: string | null;
  audioMimeType?: string | null;
  available?: boolean;
  model?: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function speakFallback(text: string): void {
  const synth = window.speechSynthesis;
  if (!synth || !text) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.05;
  synth.cancel();
  synth.speak(utter);
}

function playInlineAudio(audio: string, mimeType: string): void {
  try {
    const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mimeType || 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    el.onended = () => URL.revokeObjectURL(url);
    void el.play();
  } catch {
    // SpeechSynthesis fallback is used by the caller when this throws.
  }
}

export class AeroGeminiControl {
  private root: HTMLElement;
  private logEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private statusEl: HTMLElement;
  private micBtn: HTMLButtonElement;
  private history: unknown[] = [];
  private recording = false;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private available = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.classList.add('aero-gemini-control');
    this.root.setAttribute('data-aero-gemini', 'true');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'aero-gemini-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'aeroGeminiPanel');
    const mark = document.createElement('span');
    mark.className = 'aero-gemini-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '✦';
    const label = document.createElement('span');
    label.className = 'aero-gemini-label';
    label.textContent = 'AERO GEMINI';
    toggle.append(mark, label);
    toggle.addEventListener('click', () => this.setOpen(!this.isOpen()));

    this.micBtn = document.createElement('button');
    this.micBtn.type = 'button';
    this.micBtn.className = 'aero-gemini-mic';
    this.micBtn.setAttribute('aria-label', 'Talk to AERO GEMINI');
    this.micBtn.title = 'Talk to AERO GEMINI';
    this.micBtn.textContent = '●';
    this.micBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.toggleMic();
    });

    const panel = document.createElement('div');
    panel.id = 'aeroGeminiPanel';
    panel.className = 'aero-gemini-panel';
    panel.hidden = true;

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'aero-gemini-status';
    this.statusEl.textContent = 'Checking AERO GEMINI…';

    this.logEl = document.createElement('div');
    this.logEl.className = 'aero-gemini-log';
    this.logEl.tabIndex = 0;
    this.logEl.setAttribute('aria-live', 'polite');

    const form = document.createElement('form');
    form.className = 'aero-gemini-form';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.sendText();
    });

    this.inputEl = document.createElement('input');
    this.inputEl.className = 'aero-gemini-input';
    this.inputEl.type = 'text';
    this.inputEl.maxLength = 400;
    this.inputEl.placeholder = 'Ask AERO GEMINI — brief, navigate, rearrange…';
    this.inputEl.setAttribute('aria-label', 'AERO GEMINI message');

    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'aero-gemini-send';
    send.textContent = 'Send';

    form.append(this.inputEl, send);
    panel.append(this.statusEl, this.logEl, form);

    const bar = document.createElement('div');
    bar.className = 'aero-gemini-bar';
    bar.append(toggle, this.micBtn);

    this.root.replaceChildren(bar, panel);
    void this.refreshStatus();
  }

  private isOpen(): boolean {
    return !this.root.querySelector('.aero-gemini-panel')?.hasAttribute('hidden');
  }

  private setOpen(open: boolean): void {
    const panel = this.root.querySelector<HTMLElement>('.aero-gemini-panel');
    const toggle = this.root.querySelector<HTMLButtonElement>('.aero-gemini-toggle');
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) this.inputEl.focus();
  }

  private appendLog(role: 'user' | 'gemini' | 'tool', text: string): void {
    const row = document.createElement('div');
    row.className = `aero-gemini-row aero-gemini-row-${role}`;
    row.textContent = text;
    this.logEl.appendChild(row);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private async refreshStatus(): Promise<void> {
    try {
      const res = await fetch('/api/aero-gemini', { method: 'GET' });
      const data = await res.json() as GeminiTurnResponse;
      this.available = data.available === true;
      this.statusEl.textContent = this.available
        ? `Turn-based Gemini · ${data.model || 'gemini-2.5-flash'}`
        : 'Set GEMINI_API_KEY (Google AI Studio) — not a Maps key';
    } catch {
      this.available = false;
      this.statusEl.textContent = 'AERO GEMINI offline';
    }
  }

  private async toggleMic(): Promise<void> {
    this.setOpen(true);
    if (this.recording) {
      this.mediaRecorder?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      this.chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        this.recording = false;
        this.micBtn.classList.remove('recording');
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        void this.sendAudio(blob);
      };
      this.mediaRecorder = recorder;
      this.recording = true;
      this.micBtn.classList.add('recording');
      recorder.start();
      this.appendLog('user', 'Listening…');
    } catch {
      this.appendLog('gemini', 'Microphone permission is required to talk.');
    }
  }

  private async sendText(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text) return;
    this.inputEl.value = '';
    this.appendLog('user', text);
    await this.runTurn({ text, speak: true });
  }

  private async sendAudio(blob: Blob): Promise<void> {
    this.appendLog('user', 'Voice command');
    const audio = await blobToBase64(blob);
    await this.runTurn({
      audio,
      mimeType: blob.type || 'audio/webm',
      speak: true,
    });
  }

  private async runTurn(body: Record<string, unknown>): Promise<void> {
    let nextBody: Record<string, unknown> = {
      ...body,
      history: this.history,
      dashboardContext: dashboardContextForGemini(),
    };

    for (let hop = 0; hop < 4; hop += 1) {
      let data: GeminiTurnResponse;
      try {
        const res = await fetch('/api/aero-gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextBody),
        });
        data = await res.json() as GeminiTurnResponse;
      } catch {
        this.appendLog('gemini', 'AERO GEMINI request failed.');
        return;
      }

      if (data.error) {
        this.appendLog('gemini', data.error);
        return;
      }
      if (Array.isArray(data.history)) this.history = data.history;

      const calls = Array.isArray(data.functionCalls) ? data.functionCalls : [];
      if (calls.length) {
        const toolResults = [];
        for (const call of calls) {
          this.appendLog('tool', `${call.name}(${JSON.stringify(call.args ?? {})})`);
          const result = await executeAeroGeminiTool(call.name, call.args ?? {});
          toolResults.push({ name: call.name, response: result });
        }
        nextBody = {
          toolResults,
          history: this.history,
          dashboardContext: dashboardContextForGemini(),
          speak: true,
        };
        continue;
      }

      const text = data.text?.trim();
      if (text) this.appendLog('gemini', text);
      if (data.audio && typeof data.audio === 'string') {
        playInlineAudio(data.audio, data.audioMimeType || 'audio/wav');
      } else if (text) {
        speakFallback(text);
      }
      return;
    }
    this.appendLog('gemini', 'Stopped after too many tool hops.');
  }
}

export function mountAeroGeminiControl(root: HTMLElement): AeroGeminiControl {
  return new AeroGeminiControl(root);
}
