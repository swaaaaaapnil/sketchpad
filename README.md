# Sketchpad

A whiteboard where everything you draw looks hand-drawn. You get boxes, ellipses, diamonds, arrows, freehand ink and text. Boards save as you go, and an optional AI panel sketches a first draft of a diagram from a sentence.

## Features

- **Hand-drawn shapes:** made with roughjs and perfect-freehand on SVG. Each shape keeps its own random seed, so its wobble looks the same every time it renders.
- **Infinite canvas:** pan, zoom, select, move, resize, duplicate, and 100 steps of undo/redo.
- **Export:** SVG, PNG and JSON. You can import JSON back in.
- **Light and dark themes,** keyboard shortcuts, and autosave (Cmd/Ctrl+S saves straight away).
- **Storage:**
  - With no keys, boards stay in this browser's localStorage.
  - With Supabase keys, boards sync to Postgres. Each browser signs in anonymously, and row-level security means it only sees its own boards.
- **Draw with AI (bring your own key):** each user pastes their own Anthropic or OpenAI key. Calls go straight from the browser to the provider and are billed to the user's own account. Local models through Ollama or LM Studio work too.

## Stack

React 19 · Vite · roughjs · perfect-freehand · three.js (the home-page hero, loaded lazily) · GSAP · Supabase (optional)

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

To sync with Supabase, copy `.env.example` to `.env.local` and fill in the two values. [SETUP.md](SETUP.md) has the full Supabase steps: running the migrations and turning on anonymous sign-ins.

## Deploy

This is a static single-page app with hash routes (`#/`, `#/b/:id`), so it needs no server rewrites.

On Vercel, import the repo. The framework is Vite, the build command is `npm run build` and the output folder is `dist`. Then add these environment variables:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the anon / publishable key |

The anon key is safe to ship to the browser, because row-level security is what protects the data. Never put the service-role key in a `VITE_` variable.

## How it fits together

```
Browser (React SPA)
 ├─ Home: board list, thumbnails, three.js hero
 ├─ Editor: SVG canvas, camera, shape model, history
 │    └─ autosave (700 ms debounce)
 ├─ store.js ── localStorage                 (no keys)
 │           └─ Supabase Postgres + RLS      (keys present, anonymous auth)
 └─ AI panel ── Anthropic / OpenAI / Ollama  (user's own key, direct from browser)
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | oxlint |
