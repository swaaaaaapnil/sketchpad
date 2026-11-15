import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
const Hero3D = lazy(() => import('./Hero3D.jsx'));
import { ShapeView } from './Shapes.jsx';
import { contentBounds } from '../lib/geometry.js';
import { backendName, createBoard, deleteBoard, duplicateBoard, listBoards } from '../lib/store.js';

gsap.registerPlugin(useGSAP);

function ago(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Thumb({ shapes, dark }) {
  const b = contentBounds(shapes);
  if (!b) return <div className="thumb is-empty">Empty page</div>;
  const pad = 24;
  return (
    <svg className="thumb" viewBox={`${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {shapes.slice(0, 150).map((s) => (
        <ShapeView key={s.id} shape={s} dark={dark} />
      ))}
    </svg>
  );
}

export default function Home({ dark, setDark, onOpen }) {
  const [boards, setBoards] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef(null);

  async function refresh() {
    try {
      setBoards(await listBoards());
      setError('');
    } catch (e) {
      setError(e.message);
      setBoards([]);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .from('.home-nav', { y: -20, autoAlpha: 0, duration: 0.5 })
        .from('.hero-copy > *', { y: 28, autoAlpha: 0, stagger: 0.08, duration: 0.7 }, '-=0.2');
    },
    { scope: rootRef },
  );

  useGSAP(
    () => {
      if (!boards?.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      gsap.from('.board-card', { y: 24, autoAlpha: 0, stagger: 0.05, duration: 0.5, ease: 'power2.out', clearProps: 'all' });
    },
    { scope: rootRef, dependencies: [boards?.length] },
  );

  async function newBoard() {
    setBusy(true);
    try {
      const b = await createBoard({ dark });
      onOpen(b.id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function remove(b) {
    if (!window.confirm(`Delete “${b.title}”? This can’t be undone.`)) return;
    try {
      await deleteBoard(b.id);
      setBoards((list) => list.filter((x) => x.id !== b.id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function duplicate(b) {
    try {
      await duplicateBoard(b.id);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="home" ref={rootRef}>
      <nav className="home-nav">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <strong>Sketchpad</strong>
        </div>
        <div className="top-actions">
          <span className={`backend-badge is-${backendName}`} title={backendName === 'supabase' ? 'Your boards save to the cloud automatically' : 'Your boards are saved in this browser'}>
            <i aria-hidden="true" />
            {backendName === 'supabase' ? 'Saved to cloud' : 'Saved in this browser'}
          </span>
          <button className="icon-btn" onClick={() => setDark((d) => !d)} aria-label="Toggle dark mode">{dark ? '☾' : '☀'}</button>
        </div>
      </nav>

      <header className="hero">
        <Suspense fallback={null}><Hero3D dark={dark} /></Suspense>
        <div className="hero-copy">
          <p className="eyebrow">Hand-drawn whiteboard</p>
          <h1>
            Think it through <em>on paper</em>,<br />without the paper.
          </h1>
          <p className="lede">
            Boxes, arrows and scribbles that look like you drew them. Describe a diagram and let AI sketch the first draft. Everything saves as you go.
          </p>
          <div className="hero-actions">
            <button className="primary-btn big" onClick={newBoard} disabled={busy}>{busy ? 'Opening…' : 'New sketch'}</button>
            {boards?.length > 0 && (
              <a className="ghost-btn big" href="#boards">Your sketches ({boards.length})</a>
            )}
          </div>
        </div>
      </header>

      <section className="boards" id="boards" aria-labelledby="boards-title">
        <div className="boards-head">
          <h2 id="boards-title">Your sketches</h2>
          {boards?.length > 0 && <button className="ghost-btn" onClick={newBoard} disabled={busy}>+ New</button>}
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        {boards === null ? (
          <div className="board-grid">
            {[0, 1, 2].map((i) => <div key={i} className="board-card is-loading" />)}
          </div>
        ) : boards.length === 0 ? (
          <button className="board-empty" onClick={newBoard} disabled={busy}>
            <span className="hint-title">No sketches yet</span>
            <span>Start your first one — it takes a second.</span>
          </button>
        ) : (
          <div className="board-grid">
            {boards.map((b) => (
              <article key={b.id} className="board-card">
                <button className="board-open" onClick={() => onOpen(b.id)} aria-label={`Open ${b.title}`}>
                  <Thumb shapes={b.shapes || []} dark={dark} />
                </button>
                <div className="board-meta">
                  <div>
                    <h3>{b.title}</h3>
                    <p>{(b.shapes || []).length} shapes · {ago(b.updated_at)}</p>
                  </div>
                  <div className="board-actions">
                    <button className="icon-btn" onClick={() => duplicate(b)} aria-label={`Duplicate ${b.title}`} title="Duplicate">⧉</button>
                    <button className="icon-btn danger" onClick={() => remove(b)} aria-label={`Delete ${b.title}`} title="Delete">🗑</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
