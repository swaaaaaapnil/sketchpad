# Sketchpad — setup

A hand-drawn whiteboard: React 19 + Vite, roughjs/perfect-freehand on SVG, a three.js hero, GSAP motion, and an optional Supabase backend.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

With no Supabase keys, boards are saved in this browser's localStorage (`sketchpad.boards.v1`). The badge in the nav says which backend is active.

## Turn on Supabase sync

1. Create a project at supabase.com.
2. `cp .env.example .env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API).
3. Apply the migrations in `supabase/migrations/` in order, with `supabase db push` or by pasting each file into the SQL editor. The first creates the `boards` table, with row-level security so that `owner = auth.uid()`; the second adds size and per-user board limits. File names start with the version Supabase records, so the GitHub integration won't re-run them.
4. Authentication → Providers → turn on **Anonymous sign-ins**. Each browser gets its own user automatically.
5. Restart `npm run dev`. The badge should read "Synced with Supabase".

## "Draw with AI" (optional)

Bring your own key. Each user pastes their own Anthropic or OpenAI key into the AI panel; calls go straight from their browser to the provider and are billed to their account. "Remember on this device" saves the key in that browser's localStorage only, never in Supabase.

Optional: if you would rather pay for AI yourself, deploy the server-key edge function and set `VITE_AI_SERVER=true`:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy draw-ai
```

## System design

```
Browser (React SPA, hash routes #/ and #/b/:id)
 ├─ Home: board list, thumbnails, three.js hero (lazy chunk)
 ├─ Editor: SVG canvas, camera transform, shape model, history (100 steps)
 │    └─ autosave (700 ms debounce, flushed on leave and on Cmd+S)
 └─ store.js ── localStorage            (no keys)
              └─ Supabase Postgres + RLS (keys present, anonymous auth)
                   └─ Edge function draw-ai ──► Claude API
```

Shapes are plain JSON (`{id, type, x, y, w, h, points, style, text, seed}`). The roughjs `seed` keeps each stroke's wobble the same between renders and exports (SVG, PNG and JSON).
