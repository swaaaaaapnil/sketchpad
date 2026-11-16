import { timeAgo } from '../lib/time.js';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
const Hero3D = lazy(() => import('./Hero3D.jsx'));
import { ShapeView } from './Shapes.jsx';
import { contentBounds, onFillIds } from '../lib/geometry.js';
import { TourLauncher, queueTour } from './Tour.jsx';
import { backendName, canSignIn, createBoard, deleteBoard, duplicateBoard, getAccount, listBoards, onAccountChange, signInWithGoogle, signOut } from '../lib/store.js';
import Avatar from './Avatar.jsx';
import GoogleButton from './GoogleButton.jsx';

gsap.registerPlugin(useGSAP);

const ago = timeAgo;

function Thumb({ shapes, dark }) {
  const b = contentBounds(shapes);
  if (!b) return <div className="thumb is-empty">Empty page</div>;
  const pad = 24;
  const onFill = onFillIds(shapes);
  return (
    <svg className="thumb" viewBox={`${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {shapes.slice(0, 150).map((s) => (
        <ShapeView key={s.id} shape={s} dark={dark} onFill={onFill.has(s.id)} />
      ))}
    </svg>
  );
}

export default function Home({ dark, setDark, onOpen }) {
  const [boards, setBoards] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState(null);
  const [menu, setMenu] = useState(null); // 'account' | 'signin' | null
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef(null);
  const menuRef = useRef(null);

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
    if (!canSignIn) return;
    let live = true;
    getAccount().then((a) => live && setAccount(a)).catch(() => {});
    const off = onAccountChange((a) => {
      if (!live) return;
      setAccount(a);
      setMenu(null);
      refresh();
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  // Close the open menu on Escape or a click outside it.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(null); };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  async function doSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      setAccount(await getAccount());
      setMenu(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSigningOut(false);
    }
  }

  const isGuest = canSignIn && (!account || account.isGuest);

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
          {canSignIn && (
            <div className="menu-wrap" ref={menuRef}>
              {isGuest ? (
                <>
                  <button className="ghost-btn signin-btn" onClick={() => setMenu((m) => (m === 'signin' ? null : 'signin'))} aria-expanded={menu === 'signin'}>Sign in</button>
                  <div className={`menu signin-menu pop-card ${menu === 'signin' ? 'is-open' : ''}`} role="dialog" aria-label="Sign in" aria-hidden={menu !== 'signin'} inert={menu !== 'signin'}>
                    <p className="sp-note">Sign in to share and use Draw with AI. Sketches you made as a guest come with you.</p>
                    <GoogleButton dark={dark} onFallback={() => signInWithGoogle().catch((e) => setError(e.message))} onDone={() => setMenu(null)} onError={(e) => setError(e.message)} />
                  </div>
                </>
              ) : (
                <>
                  <button className="account-chip" onClick={() => setMenu((m) => (m === 'account' ? null : 'account'))} aria-expanded={menu === 'account'} aria-haspopup="menu" aria-label={`Account: ${account.name}`}>
                    <Avatar person={account} size={30} title={account.name} />
                  </button>
                  <div className={`menu account-menu pop-card ${menu === 'account' ? 'is-open' : ''}`} role="menu" aria-hidden={menu !== 'account'} inert={menu !== 'account'}>
                    <div className="account-who"><strong>{account.name}</strong><small>{account.email}</small></div>
                    <hr />
                    <button role="menuitem" onClick={doSignOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
                  </div>
                </>
              )}
            </div>
          )}
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
      <TourLauncher onStart={() => { queueTour(); newBoard(); }} />
    </div>
  );
}
