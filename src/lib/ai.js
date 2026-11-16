import { generateViaSupabase, supabase } from './store.js';

const SYSTEM = `You plan diagrams for a hand-drawn whiteboard app. Reply ONLY with JSON in this exact shape:
{"direction":"down","nodes":[{"id":"n1","label":"Landing page","shape":"rect","color":"blue"}],"edges":[{"from":"n1","to":"n2","label":""}]}
Rules:
- nodes are the boxes. Keep labels short (1-4 words). Use at most 16 nodes.
- shape: "rect" for steps/screens/services, "diamond" for yes/no decisions, "ellipse" for start/end.
- color: one of "none","yellow","green","blue","red","purple". Use colour to group related nodes, e.g. green for success, red for errors.
- edges connect node ids in the order things happen. Label decision branches ("yes"/"no"); leave other labels empty.
- direction: "down" for flows and processes, "right" for pipelines and timelines.
- Never nest nodes inside each other and never give coordinates; the app lays everything out.
No prose, no markdown.`;

const ALLOWED = ['rect', 'ellipse', 'diamond', 'line', 'arrow', 'text'];
const NODE_SHAPES = ['rect', 'ellipse', 'diamond'];
const COLORS = { none: 'none', yellow: '#ffec99', green: '#b2f2bb', blue: '#a5d8ff', red: '#ffc9c9', purple: '#eebefa' };
const FS = 20;

// Bring-your-own-key by default: each user pastes their own key and calls go
// straight from their browser to the provider. The server-key edge function is
// opt-in (VITE_AI_SERVER=true) for deployments that pay for AI themselves.
const serverAI = supabase && import.meta.env.VITE_AI_SERVER === 'true';

export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', baseUrl: '', model: 'claude-sonnet-5-5', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…' },
  openai: { label: 'OpenAI-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…' },
  ...(serverAI ? { supabase: { label: 'Built-in (server key)', baseUrl: '', model: 'server default', needsKey: false } } : {}),
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

function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('The model did not return JSON.');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('Could not parse the model response as JSON.');
  }
}

export function parseShapes(text) {
  const parsed = extractJSON(text);
  if (Array.isArray(parsed.nodes)) return layoutGraph(parsed);
  return legacyShapes(parsed);
}

const charW = (fs) => fs * 0.5;

// Turn {nodes, edges} into placed shapes: layered top-down (or left-right)
// layout, labels centred in their node, arrows bound to both ends.
export function layoutGraph({ nodes: rawNodes, edges: rawEdges, direction }) {
  const nodes = [];
  const byId = new Map();
  for (const n of rawNodes.slice(0, 16)) {
    const id = String(n?.id ?? '');
    if (!id || byId.has(id)) continue;
    const label = String(n.label || n.text || id).slice(0, 60);
    const shape = NODE_SHAPES.includes(n.shape) ? n.shape : 'rect';
    const node = { id, label, shape, fill: COLORS[n.color] || COLORS.none };
    // wrap long labels onto two lines
    const words = label.split(/\s+/);
    if (label.length > 18 && words.length > 1) {
      let best = 1, diff = Infinity;
      for (let k = 1; k < words.length; k++) {
        const d = Math.abs(words.slice(0, k).join(' ').length - words.slice(k).join(' ').length);
        if (d < diff) { diff = d; best = k; }
      }
      node.text = words.slice(0, best).join(' ') + '\n' + words.slice(best).join(' ');
    } else node.text = label;
    const lines = node.text.split('\n');
    const tw = Math.max(...lines.map((l) => l.length)) * charW(FS);
    const th = lines.length * FS * 1.25;
    const k = shape === 'rect' ? 1 : shape === 'ellipse' ? 1.4 : 1.8;
    node.w = Math.max(shape === 'rect' ? 140 : 120, Math.round(tw * k + 40));
    node.h = Math.max(shape === 'diamond' ? 90 : 64, Math.round(th * k + 28));
    node.tw = tw; node.th = th;
    nodes.push(node);
    byId.set(id, node);
  }
  if (!nodes.length) throw new Error('The model returned no drawable shapes.');
  const edges = (Array.isArray(rawEdges) ? rawEdges : [])
    .map((e) => ({ from: String(e?.from ?? ''), to: String(e?.to ?? ''), label: String(e?.label || '').slice(0, 24) }))
    .filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to)
    .slice(0, 30);

  // layers: longest path from roots, ignoring back edges (DFS)
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) out.get(e.from).push(e);
  const state = new Map();
  const back = new Set();
  const visit = (id) => {
    state.set(id, 1);
    for (const e of out.get(id)) {
      if (state.get(e.to) === 1) back.add(e);
      else if (!state.get(e.to)) visit(e.to);
    }
    state.set(id, 2);
  };
  const hasIn = new Set(edges.map((e) => e.to));
  for (const n of nodes) if (!hasIn.has(n.id)) visit(n.id);
  for (const n of nodes) if (!state.get(n.id)) visit(n.id);
  const fwd = edges.filter((e) => !back.has(e));
  const layer = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of fwd) {
      if (layer.get(e.to) < layer.get(e.from) + 1) { layer.set(e.to, layer.get(e.from) + 1); changed = true; }
    }
    if (!changed) break;
  }
  const layers = [];
  for (const n of nodes) (layers[layer.get(n.id)] ||= []).push(n);
  // order within a layer by the average position of parents (one sweep)
  const pos = new Map();
  layers.forEach((L) => L.forEach((n, i) => pos.set(n.id, i)));
  for (let li = 1; li < layers.length; li++) {
    const L = layers[li];
    if (!L) continue;
    const score = (n) => {
      const ps = fwd.filter((e) => e.to === n.id).map((e) => pos.get(e.from));
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(n.id);
    };
    L.sort((a, b) => score(a) - score(b));
    L.forEach((n, i) => pos.set(n.id, i));
  }

  const right = direction === 'right';
  const GAP_ALONG = 90, GAP_ACROSS = 60;
  const along = (n) => (right ? n.w : n.h);
  const across = (n) => (right ? n.h : n.w);
  const spans = layers.map((L) => (L || []).reduce((a, n) => a + across(n), 0) + GAP_ACROSS * Math.max(0, (L || []).length - 1));
  const maxSpan = Math.max(...spans);
  let cursor = 0;
  layers.forEach((L, li) => {
    if (!L) return;
    const thick = Math.max(...L.map(along));
    let c = (maxSpan - spans[li]) / 2;
    for (const n of L) {
      const a = cursor + (thick - along(n)) / 2;
      if (right) { n.x = a; n.y = c; } else { n.x = c; n.y = a; }
      c += across(n) + GAP_ACROSS;
    }
    cursor += thick + GAP_ALONG;
  });

  // centre the whole diagram on the 800x600 frame the editor expects
  const W = right ? cursor - GAP_ALONG : maxSpan;
  const H = right ? maxSpan : cursor - GAP_ALONG;
  const ox = 400 - W / 2, oy = 300 - H / 2;

  const shapes = [];
  for (const n of nodes) {
    n.x += ox; n.y += oy;
    shapes.push({ id: `node-${n.id}`, type: n.shape, x: n.x, y: n.y, w: n.w, h: n.h, stroke: 'auto', fill: n.fill });
  }
  for (const n of nodes) {
    shapes.push({ id: `label-${n.id}`, type: 'text', text: n.text, fontSize: FS, stroke: 'auto', fill: 'none', x: n.x + (n.w - n.tw) / 2, y: n.y + (n.h - n.th) / 2 });
  }
  edges.forEach((e, i) => {
    const a = byId.get(e.from), b = byId.get(e.to);
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    const arrow = { id: `edge-${i}`, type: 'arrow', x: ax, y: ay, x2: bx, y2: by, stroke: 'auto', fill: 'none', startBind: `node-${a.id}`, endBind: `node-${b.id}` };
    // back edges and same-layer edges curve so they don't cut through nodes
    if (back.has(e) || layer.get(e.from) === layer.get(e.to)) arrow.bend = Math.min(160, 40 + Math.hypot(bx - ax, by - ay) * 0.25);
    shapes.push(arrow);
    if (e.label) {
      const tw = e.label.length * charW(16);
      shapes.push({ id: `elabel-${i}`, type: 'text', text: e.label, fontSize: 16, stroke: 'auto', fill: 'none', x: (ax + bx) / 2 + (right ? -tw / 2 : 8), y: (ay + by) / 2 + (right ? -22 : -10) });
    }
  });
  return shapes;
}

function legacyShapes(parsed) {
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
