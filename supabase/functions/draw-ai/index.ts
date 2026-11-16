// Supabase Edge Function: proxies "Draw with AI" to Anthropic so the API key stays on the server.
// Deploy:  supabase secrets set ANTHROPIC_API_KEY=...  &&  supabase functions deploy draw-ai
// Only the app owner may use it: the caller must be a signed-in (non-guest) user whose
// email is listed in the ALLOWED_EMAILS secret (comma separated). Everyone else uses their own key.

const SYSTEM = `You draw simple diagrams for a sketch app. Reply ONLY with JSON in this exact shape:
{"shapes":[{"type":"rect|ellipse|diamond|line|arrow|text","x":0,"y":0,"w":0,"h":0,"x2":0,"y2":0,"text":"","stroke":"auto","fill":"none"}]}
Coordinates are pixels inside an 800x600 area. Use w/h for rect, ellipse, diamond. Use x2/y2 for line and arrow. Use x/y and text for text. Use at most 25 shapes. Use "auto" for stroke unless a color is needed. No prose, no markdown.`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const allowed = (Deno.env.get('ALLOWED_EMAILS') ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { authorization: req.headers.get('authorization') ?? '', apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' },
  });
  const user = who.ok ? await who.json() : null;
  const email = String(user?.email ?? '').toLowerCase();
  if (!user || user.is_anonymous || !email || !allowed.includes(email)) {
    return json({ error: 'The built-in AI is private. Pick a provider and use your own API key.' }, 403);
  }

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'ANTHROPIC_API_KEY is not set on the function.' }, 500);

  let prompt = '';
  try {
    prompt = String((await req.json()).prompt ?? '').slice(0, 2000);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!prompt.trim()) return json({ error: 'Prompt is empty' }, 400);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5',
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: data?.error?.message ?? `Upstream error ${res.status}` }, 502);
  const text = (data.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
  return json({ text });
});
