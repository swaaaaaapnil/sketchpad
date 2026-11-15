import { generateViaSupabase, supabase } from './store.js';

const SYSTEM = `You draw simple diagrams for a sketch app. Reply ONLY with JSON in this exact shape:
{"shapes":[{"type":"rect|ellipse|diamond|line|arrow|text","x":0,"y":0,"w":0,"h":0,"x2":0,"y2":0,"text":"","stroke":"auto","fill":"none"}]}
Coordinates are pixels inside an 800x600 area. Use w/h for rect, ellipse, diamond. Use x2/y2 for line and arrow. Use x/y and text for text. Use at most 25 shapes. Use "auto" for stroke unless a color is needed. No prose, no markdown.`;

const ALLOWED = ['rect', 'ellipse', 'diamond', 'line', 'arrow', 'text'];

// Bring-your-own-key by default: each user pastes their own key and calls go
// straight from their browser to the provider. The server-key edge function is
// opt-in (VITE_AI_SERVER=true) for deployments that pay for AI themselves.
const serverAI = supabase && import.meta.env.VITE_AI_SERVER === 'true';

export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', baseUrl: '', model: 'claude-sonnet-5-5', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…' },
  openai: { label: 'OpenAI-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…' },
  ...(serverAI ? { supabase: { label: 'Built-in (server key)', baseUrl: '', model: 'server default', needsKey: false } } : {}),
  ollama: { label: 'Local (Ollama / LM Studio)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', needsKey: false },
};

async function readError(res) {
  if (res.status === 401) return 'That API key was rejected. Check it was copied fully, or create a new one.';
  if (res.status === 429) return 'Rate limit or credit limit reached on your account. Try again shortly.';
  try {
    const data = await res.json();
    return data?.error?.message || data?.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function generateShapes({ provider, baseUrl, apiKey, model, prompt }) {
  let text;
  if (provider === 'supabase') {
    text = await generateViaSupabase(prompt);
  } else if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    text = (data.content || []).map((c) => c.text || '').join('');
  } else {
    const headers = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    text = data.choices?.[0]?.message?.content || '';
  }
  return parseShapes(text);
}

export function parseShapes(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('The model did not return JSON.');
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('Could not parse the model response as JSON.');
  }
  const list = Array.isArray(parsed.shapes) ? parsed.shapes : [];
  const shapes = list
    .filter((s) => ALLOWED.includes(s.type))
    .slice(0, 25)
    .map((s) => ({
      type: s.type,
      x: Number(s.x) || 0,
      y: Number(s.y) || 0,
      w: Number(s.w) || 120,
      h: Number(s.h) || 60,
      x2: Number(s.x2 ?? (Number(s.x) || 0) + 120),
      y2: Number(s.y2 ?? (Number(s.y) || 0)),
      text: String(s.text || ''),
      stroke: typeof s.stroke === 'string' ? s.stroke : 'auto',
      fill: typeof s.fill === 'string' ? s.fill : 'none',
    }));
  if (!shapes.length) throw new Error('The model returned no drawable shapes.');
  return shapes;
}
