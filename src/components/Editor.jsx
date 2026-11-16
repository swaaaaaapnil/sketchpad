import { timeAgo } from '../lib/time.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ShapeView } from './Shapes.jsx';
import { snapMove } from '../lib/snap.js';
import { ToolRail, StylePanel } from './Toolbar.jsx';
import AIPanel from './AIPanel.jsx';
import GoogleButton from './GoogleButton.jsx';
import {
  DEFAULT_STYLE,
  bendFromPoint,
  cloneShapes,
  contentBounds,
  curveMid,
  detachMoved,
  findBindTarget,
  createShape,
  getBounds,
  hitTest,
  isTrivial,
  makeId,
  onFillIds,
  pointOnFill,
  LIGHT_INK,
  resizeBox,
  rotateShapes,
  routeConnectors,
  scaleShape,
  shapesInRect,
  translateShape,
  withGroups,
  alignShapes,
  angleOf,
  rotatePoint,
  rotateShapeBy,
  normAngle,
  isConnector,
  BOX_TYPES,
  labelBox,
} from '../lib/geometry.js';
import { copyPNG, exportJSON, exportPNG, exportSVG } from '../lib/export.jsx';
import { backendName, boardVersion, canShare, canSignIn, disableShare, enableShare, getAccount, getBoard, getShare, joinBoard, joinLive, joinPresence, myRole, onAccountChange, saveChanges, shareUrl, signInWithGoogle, signOut } from '../lib/store.js';
import { addOps, applyOps, chunkOps, diffShapes, emptyOps, hasOps, opsToWire, orderKey, rebaseSnapshot, restoreOps } from '../lib/live.js';

import Avatar, { ringFor } from './Avatar.jsx';

gsap.registerPlugin(useGSAP);

const HIT_PX = 6;
const HANDLE_PX = 7;
const BIND_PX = 14; // how close (screen px) an arrow end must come to a shape to snap onto it
const KEY_TOOLS = { v: 'select', r: 'rect', o: 'ellipse', d: 'diamond', l: 'line', a: 'arrow', p: 'pen', t: 'text', e: 'eraser', h: 'hand' };
const STICKY = new Set(['pen', 'eraser', 'hand']); // stay active without the lock
const HANDLE_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', p1: 'move', p2: 'move', mid: 'grab' };
const ROT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M18.5 9A7 7 0 1 0 19 15" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M18.5 9A7 7 0 1 0 19 15" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round"/><path d="M20.5 4.5v5.5h-5.5z" fill="black" stroke="white" stroke-width="1"/></svg>')}") 12 12, grab`;
HANDLE_CURSOR.rot = ROT_CURSOR;
const RESIZE_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const ROT_OFFSET = 26; // screen px between the selection box and the rotate handle
const ANGLED_TYPES = new Set([...BOX_TYPES, 'text']);
/** Resize cursor for handle h on a shape turned by angle a. */
function handleCursor(h, a) {
  const i = RESIZE_DIRS.indexOf(h);
  if (i < 0 || !a) return HANDLE_CURSOR[h];
  return HANDLE_CURSOR[RESIZE_DIRS[(((i + Math.round(a / (Math.PI / 4))) % 8) + 8) % 8]];
}
const SHORTCUTS = [
  ['Tools', 'V R O D L A P T E H'],
  ['Keep tool active', 'Q'],
  ['Pan', 'Space + drag · wheel · H'],
  ['Zoom', '⌘ + wheel · pinch · = / −'],
  ['Fit to content', '0'],
  ['Select all', '⌘A'],
  ['Add to selection', 'Shift + click / drag box'],
  ['Copy · Cut · Paste', '⌘C · ⌘X · ⌘V'],
  ['Duplicate', '⌘D · Alt + drag'],
  ['Nudge', 'Arrows (Shift = 10px)'],
  ['Rotate 90° (selection or whole sketch)', 'Shift + R · Shift + Alt + R'],
  ['Group · Ungroup', 'G · Shift + G (or ⌘G · ⇧⌘G)'],
  ['Lock selection · Unlock all', 'Shift + L · Shift + Alt + L'],
  ['Align left · center · right', 'Alt + A · Alt + H · Alt + D'],
  ['Align top · middle · bottom', 'Alt + W · Alt + V · Alt + S'],
  ['Distribute horizontally · vertically', 'Shift + Alt + H · Shift + Alt + V'],
  ['Bring to front · back', '] · ['],
  ['Edit text', 'Double-click'],
  ['Keep proportions', 'Shift while resizing'],
  ['Connect an arrow', 'Draw from shape to shape'],
  ['Curve an arrow', 'Drag its middle dot'],
  ['Arrow without snapping', '⌘ while drawing'],
  ['Undo · Redo', '⌘Z · ⇧⌘Z'],
  ['Delete', '⌫'],
];

let clipboard = []; // shared across boards in this tab

const relTime = timeAgo;

export default function Editor({ boardId, joinToken, dark, setDark, onHome }) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [signInOpen, setSignInOpen] = useState(false);
  // Re-render every 30s so "Saved 4 minutes ago" keeps counting up.
  const [, setClock] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClock((c) => c + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const [title, setTitle] = useState('Untitled sketch');
  const [shapes, setShapes] = useState([]);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [tool, setTool] = useState('select');
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [selected, setSelected] = useState([]);
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 });
  const [draft, setDraft] = useState(null);
  const [guides, setGuides] = useState([]);
  const [marquee, setMarquee] = useState(null);
  const [bindHint, setBindHint] = useState(null); // id of the shape an arrow end will snap to
  const [textEdit, setTextEdit] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [hoverCursor, setHoverCursor] = useState(null);
  const [rotView, setRotView] = useState(null); // live angle readout (and turning box) while rotating
  const [toast, setToast] = useState('');
  const [save, setSave] = useState({ state: 'idle', at: null });
  const [role, setRole] = useState('owner'); // 'owner' | 'edit' | 'view'
  const [account, setAccount] = useState(null);
  const [people, setPeople] = useState([]);
  const [needSignIn, setNeedSignIn] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [share, setShare] = useState({ state: 'idle', view: '', edit: '', people: 0 });
  const isOwner = role === 'owner';
  const readOnly = role === 'view';
  const isGuest = canSignIn && (!account || account.isGuest);

  const rootRef = useRef(null);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const importRef = useRef(null);
  const toastRef = useRef(null);
  // Live sync state (see lib/live.js). base = shapes as last sent to / received from others.
  const base = useRef(new Map());
  const baseOrder = useRef('');
  const baseTitle = useRef('');
  const baseDark = useRef(null);
  const outbox = useRef(emptyOps()); // local edits not yet broadcast
  const outTimer = useRef(null);
  const saveBuf = useRef(emptyOps()); // local edits not yet saved
  const saveTimer = useRef(null);
  const saveSince = useRef(0); // when the oldest unsaved edit was made
  const inflight = useRef(null); // promise of the save in progress
  const retryMs = useRef(0);
  const inbox = useRef([]); // others' edits waiting for our drag to finish
  const touched = useRef(new Map()); // shape id -> when someone else last changed it
  const snapAt = useRef(new WeakMap()); // undo snapshot -> when it was taken
  const version = useRef(0);
  const live = useRef(null);
  const pres = useRef(null);
  const latest = useRef({});
  const [liveState, setLiveState] = useState('connecting');
  const [cursors, setCursors] = useState({});
  const camRef = useRef(cam);
  camRef.current = cam;

  /* ---------- load + autosave ---------- */

  useEffect(() => {
    let alive = true;
    (async () => {
      if (joinToken) {
        // Opening a share link: join with the link's role, then drop the token from the address bar.
        const res = await joinBoard(boardId, joinToken);
        if (res === 'signin') return { signin: true };
        window.history.replaceState(null, '', `#/b/${boardId}`);
        if (!res) throw new Error('This share link is no longer valid. Ask the owner for a new one.');
      }
      const [b, r] = await Promise.all([getBoard(boardId), myRole(boardId)]);
      return { b, r };
    })()
      .then(({ b, r, signin }) => {
        if (!alive) return;
        if (signin) return setNeedSignIn(true);
        if (!b) return setLoadError('This sketch does not exist, or it was deleted.');
        setRole(r || 'view');
        const list = Array.isArray(b.shapes) ? b.shapes : [];
        base.current = new Map(list.map((x) => [x.id, x]));
        baseOrder.current = orderKey(list);
        baseTitle.current = b.title;
        baseDark.current = null;
        outbox.current = emptyOps();
        saveBuf.current = emptyOps();
        version.current = b.version || 0;
        setTitle(b.title);
        setShapes(list);
        setSave({ state: 'saved', at: b.updated_at });
        setLoaded(true);
      })
      .catch((e) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, reloadKey]);

  // Who is signed in (Google or guest). Updates after sign-in / sign-out.
  useEffect(() => {
    getAccount().then(setAccount).catch(() => {});
    return onAccountChange(setAccount);
  }, []);

  // An edit link opened as a guest: once they sign in, join the board again.
  const realUser = !!account && !account.isGuest;
  useEffect(() => {
    if (needSignIn && realUser) {
      setNeedSignIn(false); // eslint-disable-line react-hooks/set-state-in-effect
      setReloadKey((k) => k + 1);
    }
  }, [needSignIn, realUser]);

  // Signing in can switch to another user id (and move this guest's boards to it):
  // reload the board so ownership and sharing match the new account.
  const lastAccountId = useRef(null);
  useEffect(() => {
    const id = account?.id || null;
    if (lastAccountId.current && id && id !== lastAccountId.current) setReloadKey((k) => k + 1); // eslint-disable-line react-hooks/set-state-in-effect
    if (id) lastAccountId.current = id;
  }, [account?.id]);

  // Presence: show who else is on this board right now.
  useEffect(() => {
    if (!loaded || !canShare || !account) return;
    const onCursor = (c) => {
      if (!c?.id) return;
      setCursors((all) => {
        const next = { ...all };
        if (c.gone) delete next[c.id];
        else next[c.id] = { x: c.x, y: c.y, at: Date.now() };
        return next;
      });
    };
    const p = joinPresence(boardId, { id: account.id, name: account.name, avatar: account.avatar, role: isOwner ? 'edit' : role }, setPeople, onCursor);
    pres.current = p;
    // drop cursors of people who went quiet (closed laptop, lost connection)
    const purge = setInterval(() => {
      setCursors((all) => {
        const now = Date.now();
        const keep = Object.entries(all).filter(([, c]) => now - c.at < 10000);
        return keep.length === Object.keys(all).length ? all : Object.fromEntries(keep);
      });
    }, 3000);
    return () => {
      clearInterval(purge);
      p.stop();
      pres.current = null;
      setCursors({});
    };
  }, [loaded, boardId, account, role, isOwner]);

  const lastCursor = useRef(0);
  const sendCursor = (e) => {
    if (!pres.current) return;
    const now = Date.now();
    if (now - lastCursor.current < 40) return;
    lastCursor.current = now;
    const p = toWorld(e);
    pres.current.cursor(p.x, p.y);
  };

  latest.current = { shapes, title, dark };

  /* ---------- live collaboration ---------- */

  // Someone else's edit: merge it per shape. Never echo it back or save it (they do).
  const applyRemote = useCallback((ops) => {
    const now = Date.now();
    for (const x of ops.up || []) {
      touched.current.set(x.id, now);
      base.current.set(x.id, x);
      // theirs is newer than our unsent/unsaved copy of the same shape
      outbox.current.up.delete(x.id);
      saveBuf.current.up.delete(x.id);
    }
    for (const id of ops.del || []) {
      touched.current.set(id, now);
      base.current.delete(id);
      outbox.current.up.delete(id);
      saveBuf.current.up.delete(id);
    }
    if (ops.up?.length || ops.del?.length || ops.ord) {
      setShapes((prev) => {
        const next = applyOps(prev, ops);
        if (orderKey(prev) === baseOrder.current) baseOrder.current = orderKey(next);
        return next;
      });
    }
    if (typeof ops.title === 'string') {
      baseTitle.current = ops.title;
      setTitle(ops.title);
    }
  }, []);

  // Reload from the server when we may have missed edits, keeping our unsaved ones on top.
  const resync = useCallback(async () => {
    if (inflight.current || drag.current) return false;
    const b = await getBoard(boardId);
    if (!b || inflight.current || drag.current) return false;
    const mine = opsToWire(restoreOps(addOps(emptyOps(), opsToWire(outbox.current)), saveBuf.current));
    const list = Array.isArray(b.shapes) ? b.shapes : [];
    base.current = new Map(list.map((x) => [x.id, x]));
    baseOrder.current = orderKey(list);
    baseTitle.current = b.title;
    version.current = Math.max(version.current, b.version || 0);
    setShapes(applyOps(list, mine));
    setTitle(mine.title ?? b.title);
    return true;
  }, [boardId]);

  const flushOut = useCallback(() => {
    clearTimeout(outTimer.current);
    outTimer.current = null;
    const o = outbox.current;
    if (!hasOps(o)) return;
    outbox.current = emptyOps();
    const wire = opsToWire(o);
    delete wire.dark; // the theme is personal; it is saved, not pushed to others
    if (!wire.up.length && !wire.del.length && !wire.ord && wire.title === undefined) return;
    for (const part of chunkOps(wire)) live.current?.send('ops', { ops: part });
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (inflight.current) await inflight.current.catch(() => {});
    const take = saveBuf.current;
    if (!hasOps(take)) return;
    saveBuf.current = emptyOps();
    setSave((s) => ({ ...s, state: 'saving' }));
    const job = saveChanges(boardId, opsToWire(take), () => ({
      shapes: latest.current.shapes,
      title: latest.current.title.trim() || 'Untitled sketch',
      dark: latest.current.dark,
    }));
    inflight.current = job;
    let retry = 0;
    try {
      const row = await job;
      retryMs.current = 0;
      version.current = Math.max(version.current, row.version || 0);
      live.current?.send('saved', { version: row.version });
      setSave({ state: hasOps(saveBuf.current) ? 'dirty' : 'saved', at: row.updated_at });
    } catch (e) {
      restoreOps(saveBuf.current, take);
      if (e.rateLimited) {
        retry = 1500;
        setSave((s) => ({ ...s, state: 'saving' }));
      } else {
        retryMs.current = Math.min(30000, (retryMs.current || 1500) * 2);
        retry = retryMs.current;
        setSave((s) => ({ ...s, state: 'error', message: e.message }));
      }
    } finally {
      inflight.current = null;
    }
    if (hasOps(saveBuf.current) && !saveTimer.current) saveTimer.current = setTimeout(flush, retry || 1000);
  }, [boardId]);

  // Every local change (draw, drag, undo, paste, AI...) lands here: diff, broadcast, batch the save.
  useEffect(() => {
    if (!loaded || readOnly) return;
    const d = diffShapes(base.current, baseOrder.current, shapes);
    const ops = { up: d.up, del: d.del, ord: d.ord };
    for (const x of d.up) base.current.set(x.id, x);
    for (const id of d.del) base.current.delete(id);
    baseOrder.current = d.key;
    const t = title.trim() || 'Untitled sketch';
    if (t !== baseTitle.current) {
      ops.title = t;
      baseTitle.current = t;
    }
    if (baseDark.current !== null && dark !== baseDark.current) ops.dark = dark;
    baseDark.current = dark;
    if (!ops.up.length && !ops.del.length && !ops.ord && ops.title === undefined && ops.dark === undefined) return;

    addOps(outbox.current, ops);
    if (!outTimer.current) outTimer.current = setTimeout(flushOut, 50); // ~20 updates/s while dragging

    if (!hasOps(saveBuf.current)) saveSince.current = Date.now();
    addOps(saveBuf.current, ops);
    clearTimeout(saveTimer.current);
    // save 1s after the last edit, but at least every 4s during non-stop drawing
    const wait = Math.max(0, Math.min(1000, saveSince.current + 4000 - Date.now()));
    saveTimer.current = setTimeout(flush, inflight.current ? Math.max(wait, 300) : wait);
    setSave((s) => (s.state === 'error' ? s : { ...s, state: 'dirty' }));
  }, [shapes, title, dark, loaded, readOnly, flush, flushOut]);

  // The live channel: others' edits arrive here in real time.
  useEffect(() => {
    if (!loaded || !canShare || !account) return;
    const ch = joinLive(boardId, account.id, {
      onOps: (ops) => (drag.current ? inbox.current.push(ops) : applyRemote(ops)),
      onSaved: (v) => {
        if (v) version.current = Math.max(version.current, v);
      },
      onStatus: (st, first) => {
        setLiveState(st);
        // after a reconnect (or a slow first join), catch up on anything we missed
        if (st === 'live') boardVersion(boardId).then((v) => v > version.current && resync()).catch(() => {});
        void first;
      },
    });
    live.current = ch;
    // apply edits that arrived mid-drag; every 20s check the saved version for missed edits
    const drain = setInterval(() => {
      if (!drag.current && inbox.current.length) {
        const q = inbox.current;
        inbox.current = [];
        q.forEach(applyRemote);
      }
    }, 100);
    const check = setInterval(() => {
      if (document.hidden) return;
      boardVersion(boardId).then((v) => v > version.current && resync()).catch(() => {});
    }, 20000);
    return () => {
      clearInterval(drain);
      clearInterval(check);
      flushOut();
      ch.stop();
      live.current = null;
    };
  }, [loaded, boardId, account, applyRemote, resync, flushOut]);

  // Save before the tab closes or hides, and when leaving the editor.
  useEffect(() => {
    const onUnload = () => {
      flushOut();
      flush();
    };
    const onHide = () => document.visibilityState === 'hidden' && onUnload();
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('visibilitychange', onHide);
      onUnload();
    };
  }, [flush, flushOut]);

  async function goHome() {
    flushOut();
    await flush();
    onHome();
  }

  /* ---------- motion ---------- */

  const { contextSafe } = useGSAP(
    () => {
      if (!loaded) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) return;
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('.topbar', { y: -24, autoAlpha: 0, duration: 0.5, clearProps: 'transform,opacity,visibility' })
        .from('.tool-btn', { y: -8, autoAlpha: 0, stagger: 0.03, duration: 0.35, clearProps: 'transform,opacity,visibility' }, '-=0.25')
        .from('.style-panel, .zoom-bar, .shortcut-help', { y: 24, autoAlpha: 0, stagger: 0.06, duration: 0.45, clearProps: 'transform,opacity,visibility' }, '-=0.3')
        .from('.canvas g.scene', { autoAlpha: 0, duration: 0.6 }, '<');
    },
    { scope: rootRef, dependencies: [loaded] },
  );

  const say = useCallback(
    contextSafe((msg) => {
      setToast(msg);
      requestAnimationFrame(() => {
        if (!toastRef.current) return;
        gsap.fromTo(toastRef.current, { y: 16, autoAlpha: 0, scale: 0.96 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(2)' });
      });
    }),
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---------- history ---------- */

  const commit = useCallback((before, next) => {
    if (readOnly) return;
    snapAt.current.set(before, Date.now());
    setPast((p) => [...p.slice(-99), before]);
    setFuture([]);
    setShapes(routeConnectors(next));
  }, [readOnly]);

  const undo = () => {
    if (readOnly) return;
    if (!past.length) return say('Nothing to undo');
    const target = past[past.length - 1];
    const since = snapAt.current.get(target) ?? 0;
    snapAt.current.set(shapes, Date.now());
    setFuture((f) => [shapes, ...f]);
    // keep what collaborators changed since this snapshot
    setShapes(rebaseSnapshot(target, shapes, touched.current, since));
    setPast(past.slice(0, -1));
    setSelected([]);
  };

  const redo = () => {
    if (readOnly) return;
    if (!future.length) return say('Nothing to redo');
    const target = future[0];
    const since = snapAt.current.get(target) ?? 0;
    snapAt.current.set(shapes, Date.now());
    setPast((p) => [...p, shapes]);
    setShapes(rebaseSnapshot(target, shapes, touched.current, since));
    setFuture(future.slice(1));
    setSelected([]);
  };

  const selSet = new Set(selected);
  const selShapes = shapes.filter((s) => selSet.has(s.id));
  // Figma-style groups: a click picks the whole group; double-click steps inside it,
  // after which clicks pick single members until you click away.
  const selGroupIds = new Set(selShapes.map((s) => s.groupId).filter(Boolean));
  const insideGroup = selGroupIds.size === 1 && (() => {
    const g = [...selGroupIds][0];
    return shapes.some((s) => s.groupId === g && !selSet.has(s.id));
  })();

  function deleteSelected() {
    if (!selected.length) return;
    commit(shapes, shapes.filter((s) => !selSet.has(s.id)));
    say(selected.length > 1 ? `Deleted ${selected.length} shapes` : 'Deleted');
    setSelected([]);
  }

  function pasteShapes(list, offset = 24) {
    if (!list.length) return;
    const copies = cloneShapes(list).map((s) => translateShape(s, offset, offset));
    commit(shapes, [...shapes, ...copies]);
    setSelected(copies.map((c) => c.id));
    setTool('select');
    return copies;
  }

  function copySelected(cut) {
    if (!selShapes.length) return;
    clipboard = selShapes.map((s) => ({ ...s }));
    if (cut) {
      commit(shapes, shapes.filter((s) => !selSet.has(s.id)));
      setSelected([]);
    }
    say(`${cut ? 'Cut' : 'Copied'} ${clipboard.length} shape${clipboard.length > 1 ? 's' : ''}`);
  }

  function reorder(toFront) {
    if (!selected.length) return;
    const rest = shapes.filter((s) => !selSet.has(s.id));
    commit(shapes, toFront ? [...rest, ...selShapes] : [...selShapes, ...rest]);
  }

  function nudge(dx, dy) {
    if (!selected.length) return;
    commit(shapes, detachMoved(shapes.map((s) => (selSet.has(s.id) ? translateShape(s, dx, dy) : s)), selSet));
  }

  const isOneGroup = selected.length > 1 && selGroupIds.size === 1 && selShapes.every((s) => s.groupId) && !insideGroup;

  function group() {
    if (selected.length < 2) return say('Select two or more shapes, then press G');
    if (isOneGroup) return say('Already a group');
    const groupId = makeId();
    // Grouping always merges: picking a group and another shape makes one bigger group.
    const ids = new Set(withGroups(shapes, selected));
    commit(shapes, shapes.map((s) => (ids.has(s.id) ? { ...s, groupId } : s)));
    setSelected([...ids]);
    say(`Grouped ${ids.size} shapes · Shift+G ungroups`);
  }

  function ungroup() {
    if (!selGroupIds.size) return say('Nothing grouped here');
    const ids = new Set(withGroups(shapes, selected));
    commit(shapes, shapes.map((s) => {
      if (!ids.has(s.id) || !s.groupId) return s;
      const { groupId: _drop, ...rest } = s;
      return rest;
    }));
    setSelected([...ids]);
    say('Ungrouped');
  }

  function rotate(dir) {
    if (selected.length && selBox) {
      const c = { x: selBox.x + selBox.w / 2, y: selBox.y + selBox.h / 2 };
      commit(shapes, routeConnectors(shapes.map((s) => (selSet.has(s.id) ? rotateShapeBy(s, (dir * Math.PI) / 2, c) : s))));
      return say('Rotated selection');
    }
    const ids = new Set(shapes.map((s) => s.id));
    if (!ids.size) return;
    commit(shapes, rotateShapes(shapes, ids, dir));
    say(selected.length ? 'Rotated selection' : 'Rotated sketch');
  }

  function align(how) {
    const next = alignShapes(shapes, selSet, how);
    if (next === shapes) return say(how === 'h' || how === 'v' ? 'Select three or more shapes to distribute' : 'Select two or more shapes to align');
    commit(shapes, next);
  }

  async function openShare() {
    setShareOpen((o) => !o);
    if (shareOpen || !canShare || !isOwner || isGuest) return;
    setShare((p) => ({ ...p, state: 'loading' }));
    try {
      const r = await getShare(boardId);
      setShare({ state: 'ready', view: r?.view || '', edit: r?.edit || '', people: r?.people || 0 });
    } catch (e) {
      setShare((p) => ({ ...p, state: 'error', message: e.message }));
    }
  }

  async function toggleLink(r) {
    const on = !!share[r];
    if (on && !window.confirm(`Turn off the ${r} link? People who joined with it lose access, and the old link stops working.`)) return;
    setShare((p) => ({ ...p, state: 'loading' }));
    try {
      if (on) {
        await disableShare(boardId, r);
        setShare((p) => ({ ...p, state: 'ready', [r]: '' }));
        say('Link turned off');
      } else {
        await flush();
        const token = await enableShare(boardId, r);
        setShare((p) => ({ ...p, state: 'ready', [r]: token }));
        copyLink(shareUrl(boardId, token));
      }
    } catch (e) {
      setShare((p) => ({ ...p, state: 'error', message: e.message }));
    }
  }

  function copyLink(link) {
    navigator.clipboard?.writeText(link).then(() => say('Link copied'), () => say('Could not copy — select the link and copy it'));
  }

  async function doSignIn() {
    try {
      await flush();
      await signInWithGoogle();
    } catch (e) {
      say(e.message);
    }
  }

  async function doSignOut() {
    setAccountOpen(false);
    await flush();
    await signOut();
    onHome();
  }

  function openAI() {
    if (isGuest) return say('Sign in with Google to use Draw with AI');
    setAiOpen((o) => !o);
  }

  function clearAll() {
    if (!shapes.length) return;
    if (!window.confirm('Clear the whole canvas? You can undo this.')) return;
    commit(shapes, []);
    setSelected([]);
  }

  /* ---------- camera ---------- */

  const toWorld = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left - cam.x) / cam.z, y: (e.clientY - r.top - cam.y) / cam.z };
  };

  const zoomAt = (sx, sy, factor) =>
    setCam((c) => {
      const z = Math.min(4, Math.max(0.2, c.z * factor));
      const wx = (sx - c.x) / c.z;
      const wy = (sy - c.y) / c.z;
      return { z, x: sx - wx * z, y: sy - wy * z };
    });

  function zoomBy(factor) {
    const r = svgRef.current.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, factor);
  }

  function fitView() {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const b = contentBounds(shapes);
    if (!b) return setCam({ x: r.width / 2 - 400, y: r.height / 2 - 300, z: 1 });
    const z = Math.min(1.5, Math.max(0.2, Math.min((r.width - 160) / (b.w || 1), (r.height - 220) / (b.h || 1))));
    setCam({ z, x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z });
  }

  // Wheel pans, ⌘/Ctrl + wheel (and trackpad pinch) zooms. Native listener so we can preventDefault.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = svg.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.0015)));
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setCam((c) => ({ ...c, x: c.x - dx, y: c.y - dy }));
      }
    }
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [loaded]);

  /* ---------- selection handles ---------- */

  const single = selShapes.length === 1 ? selShapes[0] : null;
  const isLine = single && (single.type === 'line' || single.type === 'arrow');
  const angledSingle = single && ANGLED_TYPES.has(single.type);
  const selAngle = angledSingle ? angleOf(single) : 0;
  // The selection frame: a turned shape keeps its own (unrotated) box plus its angle.
  const selBox = selShapes.length ? (selAngle ? getBounds(single) : contentBounds(selShapes)) : null;
  const frame = rotView?.box ? rotView : selBox ? { box: selBox, a: selAngle } : null;
  const frameC = frame && { x: frame.box.x + frame.box.w / 2, y: frame.box.y + frame.box.h / 2 };

  function handlePoints() {
    if (!selBox || tool !== 'select' || textEdit) return [];
    if (isLine) {
      const m = curveMid(single);
      return [['p1', single.x, single.y], ['p2', single.x2, single.y2], ['mid', m.x, m.y]];
    }
    const { x, y, w, h } = frame.box;
    const corners = [['nw', x, y], ['ne', x + w, y], ['se', x + w, y + h], ['sw', x, y + h]];
    const pts = [...corners, ['rot', x + w / 2, y - (4 + ROT_OFFSET) / cam.z]];
    if (single?.type !== 'text') pts.push(['n', x + w / 2, y], ['e', x + w, y + h / 2], ['s', x + w / 2, y + h], ['w', x, y + h / 2]);
    if (!frame.a) return pts;
    return pts.map(([id, hx, hy]) => {
      const q = rotatePoint({ x: hx, y: hy }, frameC, frame.a);
      return [id, q.x, q.y];
    });
  }

  function handleAt(p) {
    const tol = HANDLE_PX / cam.z;
    const pts = handlePoints();
    const hit = pts.find(([, hx, hy]) => Math.abs(p.x - hx) <= tol && Math.abs(p.y - hy) <= tol)?.[0];
    if (hit || isLine || !pts.length) return hit ?? null;
    // Figma-style: just outside a corner, dragging turns the selection.
    const q = frame.a ? rotatePoint(p, frameC, -frame.a) : p;
    const { x, y, w, h } = frame.box;
    const inside = q.x > x && q.x < x + w && q.y > y && q.y < y + h;
    if (inside) return null;
    const reach = tol + 16 / cam.z;
    const near = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].some(([cx, cy]) => Math.hypot(q.x - cx, q.y - cy) <= reach);
    return near ? 'rot' : null;
  }

  /* ---------- pointer ---------- */

  function capture(e) {
    svgRef.current.setPointerCapture(e.pointerId);
  }

  function onPointerDown(e) {
    if (textEdit) return; // blur of the text box commits it first
    setExportOpen(false);
    if (e.button === 1 || spaceHeld || tool === 'hand' || readOnly) {
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, cam0: cam };
      return capture(e);
    }
    if (e.button !== 0) return;
    const p = toWorld(e);

    if (tool === 'text') {
      const hit = hitTest(shapes, p.x, p.y, HIT_PX / cam.z);
      if (hit?.type === 'text') return startTextEdit(hit);
      e.preventDefault();
      if (hit && BOX_TYPES.has(hit.type)) return startLabelEdit(hit);
      return startTextEdit(null, p);
    }

    if (tool === 'eraser') {
      drag.current = { mode: 'erase', before: shapes, latest: shapes };
      eraseAt(p, drag.current);
      return capture(e);
    }

    if (tool === 'select') {
      const handle = handleAt(p);
      if (handle === 'rot') {
        const c = frameC;
        drag.current = {
          mode: 'rotate', c, a0: Math.atan2(p.y - c.y, p.x - c.x), base: selAngle, box: angledSingle ? null : selBox,
          origs: new Map(selShapes.map((s) => [s.id, s])), before: shapes, latest: shapes,
        };
        return capture(e);
      }
      if (handle) {
        drag.current = isLine
          ? { mode: handle === 'mid' ? 'bend' : 'endpoint', id: single.id, which: handle, before: shapes, latest: shapes }
          : { mode: 'resize', handle, box0: selBox, rot: selAngle ? { a: selAngle, c: frameC } : null, origs: new Map(selShapes.map((s) => [s.id, s])), before: shapes, latest: shapes };
        return capture(e);
      }

      const hit = hitTest(shapes, p.x, p.y, HIT_PX / cam.z, { select: true });
      if (hit) {
        let ids;
        // Inside a group (after a double-click), clicks pick single members; otherwise the whole group.
        const hitIds = insideGroup && selGroupIds.has(hit.groupId) ? [hit.id] : withGroups(shapes, [hit.id]);
        if (e.shiftKey) {
          ids = selSet.has(hit.id) ? selected.filter((id) => !hitIds.includes(id)) : [...new Set([...selected, ...hitIds])];
          setSelected(ids);
          if (!ids.includes(hit.id)) return;
        } else {
          ids = selSet.has(hit.id) ? selected : hitIds;
          setSelected(ids);
        }
        let before = shapes;
        let moveIds = ids;
        if (e.altKey) {
          // Alt + drag leaves a copy behind and drags the duplicate.
          const copies = cloneShapes(shapes.filter((s) => ids.includes(s.id)));
          before = [...shapes, ...copies];
          moveIds = copies.map((c) => c.id);
          setShapes(before);
          setSelected(moveIds);
        }
        const set = new Set(moveIds);
        drag.current = {
          mode: 'move',
          start: p,
          origs: before.filter((s) => set.has(s.id)),
          set,
          base: shapes,
          before,
          latest: before,
          moved: false,
        };
        return capture(e);
      }

      drag.current = { mode: 'marquee', start: p, base: e.shiftKey ? selected : [] };
      if (!e.shiftKey) setSelected([]);
      return capture(e);
    }

    const shape = createShape(tool, p, style);
    if ((tool === 'line' || tool === 'arrow') && !(e.metaKey || e.ctrlKey)) {
      // Start on (or next to) a shape: the arrow attaches to it.
      const target = findBindTarget(shapes, p, BIND_PX / cam.z);
      if (target) shape.startBind = target.id;
    }
    setDraft(shape);
    setSelected([]);
    drag.current = { mode: 'draw', start: p, draft: shape, before: shapes };
    capture(e);
  }

  function eraseAt(p, d) {
    const hit = hitTest(d.latest, p.x, p.y, HIT_PX / cam.z);
    if (hit) {
      d.latest = d.latest.filter((s) => s.id !== hit.id);
      setShapes(d.latest);
    }
  }

  function onPointerMove(e) {
    sendCursor(e);
    const d = drag.current;
    if (!d) {
      if (tool === 'select' && !spaceHeld) {
        const p = toWorld(e);
        const h = handleAt(p);
        setHoverCursor(h ? handleCursor(h, frame?.a) : hitTest(shapes, p.x, p.y, HIT_PX / cam.z, { select: true }) ? 'move' : null);
      }
      return;
    }
    if (d.mode === 'pan') {
      setCam({ ...d.cam0, x: d.cam0.x + (e.clientX - d.sx), y: d.cam0.y + (e.clientY - d.sy) });
      return;
    }
    const p = toWorld(e);

    if (d.mode === 'erase') return eraseAt(p, d);

    if (d.mode === 'move') {
      let dx = p.x - d.start.x;
      let dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * cam.z < 2) return;
      d.moved = true;
      if (!(e.metaKey || e.ctrlKey)) {
        // Smart guides: snap to other shapes' edges/centres (hold ⌘/Ctrl to move freely).
        const others = d.before.filter((s) => !d.set.has(s.id));
        const snap = snapMove(d.origs.filter((s) => !isConnector(s)), others, dx, dy, 6 / cam.z);
        dx = snap.dx;
        dy = snap.dy;
        setGuides(snap.guides);
      } else setGuides([]);
      const byId = new Map(d.origs.map((s) => [s.id, translateShape(s, dx, dy)]));
      d.latest = routeConnectors(detachMoved(d.before.map((s) => byId.get(s.id) ?? s), d.set));
      setShapes(d.latest);
      return;
    }

    if (d.mode === 'resize') {
      const q = d.rot ? rotatePoint(p, d.rot.c, -d.rot.a) : p; // resize a turned shape in its own frame
      const nb = resizeBox(d.box0, d.handle, q, e.shiftKey);
      const cl = { x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 };
      const cw = d.rot ? rotatePoint(cl, d.rot.c, d.rot.a) : cl; // keeps the opposite corner where it was
      d.latest = routeConnectors(d.before.map((s) => {
        if (!d.origs.has(s.id)) return s;
        const scaled = scaleShape(d.origs.get(s.id), d.box0, nb);
        return d.rot ? translateShape(scaled, cw.x - cl.x, cw.y - cl.y) : scaled;
      }));
      setShapes(d.latest);
      return;
    }

    if (d.mode === 'rotate') {
      let total = d.base + Math.atan2(p.y - d.c.y, p.x - d.c.x) - d.a0;
      if (e.shiftKey) total = Math.round(total / (Math.PI / 12)) * (Math.PI / 12); // 15° steps
      const delta = total - d.base;
      d.latest = routeConnectors(d.before.map((s) => (d.origs.has(s.id) ? rotateShapeBy(d.origs.get(s.id), delta, d.c) : s)));
      setShapes(d.latest);
      setRotView({ box: d.box, a: delta, deg: Math.round((normAngle(total) * 180) / Math.PI), at: p });
      return;
    }

    if (d.mode === 'endpoint') {
      const orig = d.before.find((s) => s.id === d.id);
      const start = d.which === 'p1';
      const key = start ? 'startBind' : 'endBind';
      const other = start ? orig.endBind : orig.startBind;
      const target = e.metaKey || e.ctrlKey ? null : findBindTarget(d.before, p, BIND_PX / cam.z, [d.id, other].filter(Boolean));
      const next = start ? { ...orig, x: p.x, y: p.y } : { ...orig, x2: p.x, y2: p.y };
      if (target) next[key] = target.id;
      else delete next[key];
      setBindHint(target?.id ?? null);
      d.latest = routeConnectors(d.before.map((s) => (s.id === d.id ? next : s)));
      setShapes(d.latest);
      return;
    }

    if (d.mode === 'bend') {
      const orig = d.before.find((s) => s.id === d.id);
      // Bound ends slide as the curve changes, so refine a few times to keep the handle under the pointer.
      // Damped fixed-point iteration: converges onto the pointer in a few steps.
      let cur = orig;
      let latest = d.before;
      let bend = 0, skew = 0;
      for (let i = 0; i < 8; i++) {
        const t = bendFromPoint(cur, p);
        bend = i ? (bend + t.bend) / 2 : t.bend;
        skew = i ? (skew + t.skew) / 2 : t.skew;
        const snap = Math.abs(bend) * cam.z < 8; // snap back to straight
        latest = routeConnectors(d.before.map((s) => (s.id === d.id ? { ...orig, bend: snap ? 0 : bend, skew: snap ? 0 : skew } : s)));
        cur = latest.find((s) => s.id === d.id);
        if (snap) break;
      }
      d.latest = latest;
      setShapes(d.latest);
      return;
    }

    if (d.mode === 'marquee') {
      const rect = { x: d.start.x, y: d.start.y, w: p.x - d.start.x, h: p.y - d.start.y };
      setMarquee(rect);
      const inside = withGroups(shapes, shapesInRect(shapes, rect));
      setSelected([...new Set([...d.base, ...inside])]);
      return;
    }

    if (d.mode === 'draw') {
      const s = d.draft;
      let next;
      if (s.type === 'pen') {
        next = { ...s, points: [...s.points, [p.x, p.y, e.pressure || 0.5]] };
      } else if (s.type === 'line' || s.type === 'arrow') {
        let x2 = p.x, y2 = p.y;
        const target = e.metaKey || e.ctrlKey ? null : findBindTarget(shapes, p, BIND_PX / cam.z, s.startBind ? [s.startBind] : []);
        setBindHint(target?.id ?? null);
        if (e.shiftKey && !target) {
          // snap to 15° steps
          const ang = Math.round(Math.atan2(y2 - s.y, x2 - s.x) / (Math.PI / 12)) * (Math.PI / 12);
          const len = Math.hypot(x2 - s.x, y2 - s.y);
          x2 = s.x + Math.cos(ang) * len;
          y2 = s.y + Math.sin(ang) * len;
        }
        next = { ...s, x2, y2 };
        if (target) next.endBind = target.id;
        else delete next.endBind;
        if (next.startBind || next.endBind) {
          const [routed] = routeConnectors([...shapes, next]).slice(-1);
          next = routed;
        }
      } else {
        let w = p.x - d.start.x, h = p.y - d.start.y;
        if (e.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m;
          h = Math.sign(h || 1) * m;
        }
        next = { ...s, x: Math.min(d.start.x, d.start.x + w), y: Math.min(d.start.y, d.start.y + h), w: Math.abs(w), h: Math.abs(h) };
      }
      d.draft = next;
      setDraft(next);
    }
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    setBindHint(null);
    setGuides([]);
    if (!d) return;

    if (d.mode === 'move') {
      if (d.moved) commit(d.base, d.latest);
      else if (d.before !== d.base) setShapes(d.base); // alt-click without drag: drop the copy
      return;
    }
    if (d.mode === 'rotate') {
      setRotView(null);
      if (d.latest !== d.before) commit(d.before, d.latest);
      return;
    }
    if ((d.mode === 'resize' || d.mode === 'endpoint' || d.mode === 'bend' || d.mode === 'erase') && d.latest !== d.before) {
      commit(d.before, d.latest);
      return;
    }
    if (d.mode === 'marquee') {
      setMarquee(null);
      return;
    }
    if (d.mode === 'draw') {
      let s = d.draft;
      setDraft(null);
      if (isTrivial(s) && BOX_TYPES.has(s.type)) {
        // A click with a shape tool drops a default-sized shape.
        const w = s.type === 'sticky' ? 160 : 140, h = s.type === 'sticky' ? 160 : 80;
        s = { ...s, x: s.x - w / 2, y: s.y - h / 2, w, h };
      }
      if (isTrivial(s)) return;
      commit(d.before, [...d.before, s]);
      if (!STICKY.has(tool)) {
        setTool('select');
        setSelected([s.id]);
      }
    }
  }

  function onDoubleClick(e) {
    if (readOnly) return;
    if (tool !== 'select' && tool !== 'text') return;
    const p = toWorld(e);
    const hit = hitTest(shapes, p.x, p.y, HIT_PX / cam.z, { select: true });
    if (hit?.groupId && selSet.has(hit.id) && !insideGroup && selected.length > 1) {
      setSelected([hit.id]); // step into the group: just this member
      return say('Inside group · click away to leave');
    }
    if (hit?.type === 'text') return startTextEdit(hit);
    if (hit && BOX_TYPES.has(hit.type)) return startLabelEdit(hit);
    startTextEdit(null, p);
  }

  /* ---------- text ---------- */

  function startTextEdit(shape, p) {
    if (shape) {
      setSelected([shape.id]);
      setTextEdit({ id: shape.id, x: shape.x, y: shape.y, value: shape.text, fontSize: shape.fontSize || 24, stroke: shape.stroke });
    } else {
      setSelected([]);
      setTextEdit({ id: null, x: p.x, y: p.y, value: '', fontSize: Math.round((style.fontSize || 24) / Math.min(1, cam.z)), stroke: style.stroke });
    }
  }

  /** Edit the text that lives inside a box shape (moves, resizes and wraps with it). */
  function startLabelEdit(shape) {
    setSelected([shape.id]);
    setTextEdit({ id: shape.id, label: true, box: labelBox(shape), x: shape.x, y: shape.y, value: shape.label || '', fontSize: shape.fontSize || 20, stroke: shape.stroke });
  }

  function finishText(keep) {
    const t = textEdit;
    if (!t) return;
    setTextEdit(null);
    if (!keep) return;
    const value = t.value.replace(/\s+$/, '');
    if (t.label) {
      const orig = shapes.find((s) => s.id === t.id);
      if (orig && (orig.label || '') !== value) {
        commit(shapes, shapes.map((s) => {
          if (s.id !== t.id) return s;
          const { label: _drop, ...rest } = s;
          return value ? { ...rest, label: value } : rest;
        }));
      }
      return;
    }
    if (t.id) {
      const orig = shapes.find((s) => s.id === t.id);
      if (!value) {
        commit(shapes, shapes.filter((s) => s.id !== t.id));
        setSelected([]);
      } else if (orig && orig.text !== value) {
        commit(shapes, shapes.map((s) => (s.id === t.id ? { ...s, text: value } : s)));
      }
    } else if (value) {
      const s = { id: makeId(), type: 'text', x: t.x, y: t.y, text: value, stroke: t.stroke, fontSize: t.fontSize, strokeWidth: 2, fill: 'none', seed: 0 };
      commit(shapes, [...shapes, s]);
      setSelected([s.id]);
    }
    setTool('select');
  }

  /* ---------- style ---------- */

  const onFill = onFillIds(shapes);
  const shownStyle = single ? { ...style, stroke: single.stroke, fill: single.fill ?? 'none', strokeWidth: single.strokeWidth ?? 2 } : style;

  function applyStyle(patch) {
    setStyle((s) => ({ ...s, ...patch }));
    if (selected.length) commit(shapes, shapes.map((s) => (selSet.has(s.id) ? { ...s, ...patch } : s)));
  }

  /* ---------- AI + import/export ---------- */

  function addAIShapes(list) {
    const r = svgRef.current.getBoundingClientRect();
    const ox = (r.width / 2 - cam.x) / cam.z - 400;
    const oy = (r.height / 2 - cam.y) / cam.z - 300;
    const made = cloneShapes(list.map((s, i) => ({ id: s.id || `ai-${i}`, ...s }))).map((s) => ({
      ...DEFAULT_STYLE,
      ...s,
      seed: Math.floor(Math.random() * 100000),
      strokeWidth: 2,
      x: s.x + ox,
      y: s.y + oy,
      ...(s.x2 != null ? { x2: s.x2 + ox, y2: s.y2 + oy } : {}),
    }));
    commit(shapes, [...shapes, ...made]);
    setSelected(made.map((m) => m.id));
    setTool('select');
    setAiOpen(false);
    say(`Added ${made.length} shapes — drag to place them`);
  }

  const exportTarget = selShapes.length ? selShapes : shapes;
  const safeTitle = (title.trim() || 'sketch').replace(/[^\w-]+/g, '-').toLowerCase();

  function doExport(kind) {
    setExportOpen(false);
    if (!exportTarget.length) return say('Nothing to export yet');
    if (kind === 'png') exportPNG(exportTarget, dark, safeTitle);
    if (kind === 'svg') exportSVG(exportTarget, dark, safeTitle);
    if (kind === 'json') exportJSON(exportTarget, dark, safeTitle);
    if (kind === 'copy') copyPNG(exportTarget, dark).then(() => say('Copied image to clipboard'), () => say('Could not copy — your browser blocked it'));
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.shapes)) throw new Error('Not a sketch file');
      const added = cloneShapes(data.shapes);
      commit(shapes, [...shapes, ...added]);
      setSelected(added.map((s) => s.id));
      say(`Imported ${added.length} shapes`);
    } catch {
      say('That file is not a valid sketch');
    }
  }

  /* ---------- keyboard ---------- */

  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (readOnly && !(mod ? k === 'c' : ['Escape', '?', '0', '=', '+', '-', ' '].includes(e.key))) return;

      if (e.code === 'KeyG' && !e.altKey) {
        e.preventDefault(); // G or ⌘G groups, Shift+G or ⇧⌘G ungroups
        return e.shiftKey ? ungroup() : group();
      }
      if (mod) {
        const actions = {
          z: () => (e.shiftKey ? redo() : undo()),
          y: redo,
          d: () => pasteShapes(selShapes),
          a: () => {
            setTool('select');
            setSelected(shapes.map((s) => s.id));
          },
          c: () => copySelected(false),
          x: () => copySelected(true),
          v: () => pasteShapes(clipboard),
          s: () => flush().then(() => say('Saved')),
        };
        if (actions[k]) {
          e.preventDefault();
          actions[k]();
        }
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') return deleteSelected();
      if (e.key === 'Escape') {
        setSelected([]);
        setAiOpen(false);
        setExportOpen(false);
        setShareOpen(false);
        setHelpOpen(false);
        if (drag.current?.mode === 'draw') {
          drag.current = null;
          setDraft(null);
        }
        return;
      }
      if (e.key.startsWith('Arrow') && selected.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        return nudge(dx, dy);
      }
      if (e.code === 'KeyR' && e.shiftKey) return rotate(e.altKey ? -1 : 1);
      if (e.altKey && !e.shiftKey) {
        const how = { KeyA: 'left', KeyH: 'hcenter', KeyD: 'right', KeyW: 'top', KeyV: 'vcenter', KeyS: 'bottom' }[e.code];
        if (how) {
          e.preventDefault();
          return align(how);
        }
      }
      if (e.altKey && e.shiftKey && (e.code === 'KeyH' || e.code === 'KeyV')) {
        e.preventDefault();
        return align(e.code === 'KeyH' ? 'h' : 'v');
      }
      if (e.key === '?') return setHelpOpen((o) => !o);
      if (e.key === ']') return reorder(true);
      if (e.key === '[') return reorder(false);
      if (KEY_TOOLS[k]) {
        setTool(KEY_TOOLS[k]);
        if (KEY_TOOLS[k] !== 'select') setSelected([]);
      }
      if (e.key === '0') fitView();
      if (e.key === '=' || e.key === '+') zoomBy(1.2);
      if (e.key === '-') zoomBy(1 / 1.2);
    }
    function onKeyUp(e) {
      if (e.key === ' ') setSpaceHeld(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  /* ---------- render ---------- */

  if (loadError) {
    return (
      <div className="editor-state">
        <p className="hint-title">Couldn’t open this sketch</p>
        <p>{loadError}</p>
        <button className="primary-btn" onClick={onHome}>Back to all sketches</button>
      </div>
    );
  }

  if (needSignIn) {
    return (
      <div className="editor-state">
        <p className="hint-title">Sign in to edit this sketch</p>
        <p>You were invited to edit. Sign in with Google so others can see who made each change.</p>
        <GoogleButton before={flush} dark={dark} onFallback={doSignIn} onError={(e) => say(e.message)} />
        <button className="ghost-btn" onClick={onHome}>Not now</button>
      </div>
    );
  }

  const cursor = drag.current?.mode === 'pan' ? 'grabbing'
    : spaceHeld || tool === 'hand' || readOnly ? 'grab'
    : tool === 'select' ? hoverCursor || 'default'
    : tool === 'text' ? 'text'
    : tool === 'eraser' ? 'cell' : 'crosshair';

  const z = cam.z;
  const saveLabel = {
    idle: '',
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    saved: `Saved ${relTime(save.at)}`,
    error: 'Not saved — retrying',
  }[save.state];
  const together = people.length > 1;
  const reconnecting = canShare && account && together && liveState === 'offline';

  return (
    <div className="app" ref={rootRef}>
      <header className="topbar">
        <div className="brand">
          <button className="icon-btn back-btn" onClick={goHome} aria-label="All sketches" title="All sketches">←</button>
          <div className="title-block">
            <input
              className="title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 120))}
              readOnly={readOnly}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label="Sketch title"
              spellCheck={false}
            />
            <span className={`save-state is-${save.state}`} title={save.message || ''}>
              <i aria-hidden="true" />
              {reconnecting ? 'Reconnecting…' : saveLabel}
              <em>{backendName !== 'supabase' ? ' · this browser' : together && liveState === 'live' ? ' · live' : ' · cloud'}</em>
            </span>
          </div>
        </div>

        {readOnly ? <span className="view-badge" title="You can look and export, but not change this sketch">👁 View only</span> : <ToolRail
          tool={tool}
          onTool={(t) => {
            setTool(t);
            if (t !== 'select') setSelected([]);
          }}
        />}

        <div className="top-actions">
          {people.length > 1 && (
            <div className="presence" aria-label={`${people.length} people here`}>
              {people.slice(0, 4).map((p) => <Avatar key={p.id} person={{ ...p, you: p.id === account?.id }} />)}
              {people.length > 4 && <span className="pv-avatar more">+{people.length - 4}</span>}
            </div>
          )}
          {!readOnly && <div className="btn-pair" role="group" aria-label="History">
            <button className="icon-btn" onClick={undo} disabled={!past.length} title="Undo (⌘Z)" aria-label="Undo">↶</button>
            <button className="icon-btn" onClick={redo} disabled={!future.length} title="Redo (⇧⌘Z)" aria-label="Redo">↷</button>
          </div>}
          <div className="menu-wrap">
            <button className="ghost-btn share-btn" onClick={openShare} aria-expanded={shareOpen}>Share</button>
            {(
              // always mounted (hidden when closed) so Google's button is ready and nothing redraws on open
              <div className={`share-panel pop-card ${shareOpen ? 'is-open' : ''}`} role="dialog" aria-label="Share sketch" aria-hidden={!shareOpen} inert={!shareOpen}>
                <header className="sp-head">
                  <h3>Share sketch</h3>
                  <button className="sp-x" onClick={() => setShareOpen(false)} aria-label="Close">✕</button>
                </header>
                {!canShare ? (
                  <p className="sp-note">Sharing needs the cloud version. This copy keeps sketches in this browser only.</p>
                ) : !isOwner ? (
                  <>
                    <p className="sp-label">{readOnly ? 'You can view' : 'You can edit'}</p>
                    <p className="sp-note">{readOnly ? 'You can look around and export, but not change this sketch.' : 'Your changes save for everyone on this sketch.'} Only the owner can change who has access.</p>
                    <button className="sp-primary" onClick={() => copyLink(window.location.href)}><span aria-hidden="true">🔗</span> Copy link</button>
                  </>
                ) : isGuest ? (
                  <>
                    <p className="sp-note">Sign in with Google to share. Your sketches stay yours when you sign in.</p>
                    <GoogleButton before={flush} dark={dark} fallbackClass="sp-primary" onFallback={doSignIn} onError={(e) => say(e.message)} />
                  </>
                ) : (
                  <>
                    {[['view', 'Can view', 'Look and export'], ['edit', 'Can edit', 'Needs a Google sign-in']].map(([r, label, hint]) => (
                      <div key={r} className={`sp-linkrow ${share[r] ? 'is-on' : ''}`}>
                        <div className="sp-linkrow-text">
                          <strong>Anyone with the link · {label}</strong>
                          <small>{hint}</small>
                        </div>
                        <button
                          className="sp-toggle"
                          role="switch"
                          aria-checked={!!share[r]}
                          aria-label={`${label} link`}
                          disabled={share.state === 'loading'}
                          onClick={() => toggleLink(r)}
                        ><i /></button>
                        {share[r] && <button className="sp-copy" onClick={() => copyLink(shareUrl(boardId, share[r]))}>Copy</button>}
                      </div>
                    ))}
                    {share.state === 'error' && <p className="sp-note is-error">{share.message}</p>}
                    <p className="sp-foot">{share.people ? `${share.people} ${share.people > 1 ? 'people have' : 'person has'} joined. ` : ''}Turning a link off removes the people who joined with it. Links never carry API keys.</p>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="menu-wrap">
            <button className="ghost-btn" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}>Export</button>
            {exportOpen && (
              <div className="menu" role="menu">
                <p className="menu-note">{selShapes.length ? `Selection · ${selShapes.length} shape${selShapes.length > 1 ? 's' : ''}` : 'Whole canvas'}</p>
                <button role="menuitem" onClick={() => doExport('png')}>PNG image (2×)</button>
                <button role="menuitem" onClick={() => doExport('copy')}>Copy as image</button>
                <button role="menuitem" onClick={() => doExport('svg')}>SVG vector</button>
                <button role="menuitem" onClick={() => doExport('json')}>JSON (editable)</button>
                {!readOnly && <>
                  <hr />
                  <button role="menuitem" onClick={() => { importRef.current.click(); setExportOpen(false); }}>Import JSON…</button>
                  <button role="menuitem" className="danger" onClick={() => { clearAll(); setExportOpen(false); }}>Clear canvas</button>
                </>}
              </div>
            )}
            <input ref={importRef} type="file" accept="application/json" hidden onChange={onImportFile} />
          </div>
          <button className="icon-btn" onClick={() => setHelpOpen((o) => !o)} aria-label="Keyboard shortcuts" title="Shortcuts (?)">?</button>
          <button className="icon-btn" onClick={() => setDark((d) => !d)} aria-label="Toggle dark mode" title="Toggle theme">{dark ? '☾' : '☀'}</button>
          {!readOnly && <button className="primary-btn small ai-btn" onClick={openAI} aria-expanded={aiOpen} aria-label="Draw with AI">✦<span> Draw with AI</span></button>}
          {canSignIn && (isGuest ? (
            <div className="menu-wrap">
              <button className="ghost-btn signin-btn" onClick={() => setSignInOpen((o) => !o)} aria-expanded={signInOpen}>Sign in</button>
              {(
                <div className={`menu signin-menu pop-card ${signInOpen ? 'is-open' : ''}`} role="dialog" aria-label="Sign in" aria-hidden={!signInOpen} inert={!signInOpen}>
                  <p className="sp-note">Sign in to share and use Draw with AI. Your sketches stay yours.</p>
                  <GoogleButton before={flush} dark={dark} onFallback={doSignIn} onDone={() => setSignInOpen(false)} onError={(e) => say(e.message)} />
                </div>
              )}
            </div>
          ) : (
            <div className="menu-wrap">
              <button className="account-chip" onClick={() => setAccountOpen((o) => !o)} aria-expanded={accountOpen} aria-label="Account">
                <Avatar person={{ ...account, role: 'edit', you: true }} size={30} />
              </button>
              {accountOpen && (
                <div className="menu account-menu" role="menu">
                  <div className="account-who"><strong>{account.name}</strong><small>{account.email}</small></div>
                  <hr />
                  <button role="menuitem" onClick={doSignOut}>Sign out</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </header>

      <main className="stage">
        <svg
          ref={svgRef}
          className="canvas"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            setHoverCursor(null);
            pres.current?.cursor(null);
          }}
          onDoubleClick={onDoubleClick}
          role="img"
          aria-label="Drawing canvas"
        >
          <g className="scene" transform={`translate(${cam.x} ${cam.y}) scale(${z})`}>
            {shapes.map((s) => (textEdit?.id === s.id && !textEdit.label ? null : <ShapeView key={s.id} shape={s} dark={dark} onFill={onFill.has(s.id)} hideLabel={textEdit?.id === s.id} />))}
            {guides.map((g, i) => (
              <line key={`g${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={g.gap ? '#e8590c' : '#f03e3e'} strokeWidth={1 / z} strokeDasharray={g.gap ? `${4 / z} ${3 / z}` : undefined} pointerEvents="none" />
            ))}
            {draft && <ShapeView shape={draft} dark={dark} onFill={draft.type === 'pen' && draft.stroke === 'auto' && draft.points.length > 0 && pointOnFill(shapes, draft.points[0][0], draft.points[0][1])} />}

            {selShapes.length > 1 &&
              selShapes.map((s) => {
                const b = getBounds(s);
                const a = angleOf(s);
                return <rect key={s.id} x={b.x} y={b.y} width={b.w} height={b.h} className="sel-each" strokeWidth={1 / z} pointerEvents="none" transform={a ? `rotate(${(a * 180) / Math.PI} ${b.x + b.w / 2} ${b.y + b.h / 2})` : undefined} />;
              })}

            {insideGroup && tool === 'select' && (() => {
              const g = [...selGroupIds][0];
              const b = contentBounds(shapes.filter((x) => x.groupId === g));
              return <rect x={b.x - 6 / z} y={b.y - 6 / z} width={b.w + 12 / z} height={b.h + 12 / z} className="group-box" strokeWidth={1 / z} strokeDasharray={`${4 / z} ${3 / z}`} pointerEvents="none" />;
            })()}
            {selBox && !textEdit && !isLine && tool === 'select' && (
              <line
                x1={frameC.x} y1={frame.box.y - 4 / z} x2={frameC.x} y2={frame.box.y - (4 + ROT_OFFSET) / z}
                className="sel-box" strokeWidth={1.5 / z} pointerEvents="none"
                transform={frame.a ? `rotate(${(frame.a * 180) / Math.PI} ${frameC.x} ${frameC.y})` : undefined}
              />
            )}
            {selBox && !textEdit && !isLine && (
              <rect
                transform={frame.a ? `rotate(${(frame.a * 180) / Math.PI} ${frameC.x} ${frameC.y})` : undefined}
                x={frame.box.x - 4 / z}
                y={frame.box.y - 4 / z}
                width={frame.box.w + 8 / z}
                height={frame.box.h + 8 / z}
                className="sel-box"
                strokeWidth={1.5 / z}
                strokeDasharray={`${5 / z} ${4 / z}`}
                rx={6 / z}
                pointerEvents="none"
              />
            )}
            {handlePoints().map(([id, hx, hy]) => id === 'rot' ? (
              <circle key={id} cx={hx} cy={hy} r={5.5 / z} className="sel-handle is-rot" strokeWidth={1.5 / z} pointerEvents="none" />
            ) : (
              <rect
                transform={frame?.a && !isLine ? `rotate(${(frame.a * 180) / Math.PI} ${hx} ${hy})` : undefined}
                key={id}
                x={hx - 5 / z}
                y={hy - 5 / z}
                width={10 / z}
                height={10 / z}
                rx={id.startsWith('p') || id === 'mid' ? 5 / z : 2.5 / z}
                className={id === 'mid' ? 'sel-handle is-bend' : 'sel-handle'}
                strokeWidth={1.5 / z}
                pointerEvents="none"
              />
            ))}
            {bindHint && (() => {
              const t = shapes.find((s) => s.id === bindHint);
              if (!t) return null;
              const b = getBounds(t);
              const pad = 6 / z;
              return (
                <rect
                  x={b.x - pad}
                  y={b.y - pad}
                  width={b.w + pad * 2}
                  height={b.h + pad * 2}
                  rx={t.type === 'ellipse' ? Math.min(b.w, b.h) / 2 + pad : 8 / z}
                  className="bind-hint"
                  strokeWidth={2 / z}
                  pointerEvents="none"
                />
              );
            })()}
            {marquee && (
              <rect
                x={Math.min(marquee.x, marquee.x + marquee.w)}
                y={Math.min(marquee.y, marquee.y + marquee.h)}
                width={Math.abs(marquee.w)}
                height={Math.abs(marquee.h)}
                className="marquee"
                strokeWidth={1 / z}
                pointerEvents="none"
              />
            )}
            {Object.entries(cursors).map(([id, c]) => {
              const who = people.find((p) => p.id === id);
              if (!who) return null;
              const name = (who.name || 'Someone').split(' ')[0];
              return (
                <g key={id} className="peer-cursor" transform={`translate(${c.x} ${c.y}) scale(${1 / z})`} style={{ '--ring': ringFor(id) }} pointerEvents="none">
                  <path d="M0 0 L0 16 L4.5 12 L7.5 19 L10 18 L7 11 L13 11 Z" />
                  <text x="14" y="26">{name}</text>
                </g>
              );
            })}
          </g>
        </svg>

        {textEdit && (
          <textarea
            className={`text-input ${textEdit.label ? 'is-label' : ''}`}
            autoFocus
            rows={Math.max(1, textEdit.value.split('\n').length)}
            value={textEdit.value}
            onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finishText(true);
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                finishText(false);
              }
            }}
            onBlur={() => finishText(true)}
            style={textEdit.label ? {
              left: cam.x + textEdit.box.x * z,
              top: cam.y + (textEdit.box.y + textEdit.box.h / 2) * z,
              width: textEdit.box.w * z,
              fontSize: Math.min(textEdit.fontSize, 20) * z,
              color: 'var(--ink)',
            } : {
              left: cam.x + textEdit.x * z,
              top: cam.y + textEdit.y * z,
              fontSize: textEdit.fontSize * z,
              color: textEdit.stroke !== 'auto' ? textEdit.stroke : pointOnFill(shapes, textEdit.x + 4, textEdit.y + textEdit.fontSize * 0.6, shapes.length, textEdit.id) ? LIGHT_INK : 'var(--ink)',
            }}
            aria-label="Text"
            placeholder="Type · Enter to place · Shift+Enter for a new line"
          />
        )}

        {loaded && shapes.length === 0 && !draft && !textEdit && (
          <div className="empty-hint" aria-hidden="true">
            <p className="hint-title">A blank page, drawn by hand.</p>
            <p>Press <kbd>R</kbd> for a box, <kbd>P</kbd> to draw freehand, double-click to write, or open <strong>Draw with AI</strong>.</p>
          </div>
        )}
        {!loaded && <div className="empty-hint"><p className="hint-title">Opening sketch…</p></div>}

        {!readOnly && tool !== 'hand' && tool !== 'eraser' && <StylePanel style={shownStyle} onStyle={applyStyle} />}

        {!readOnly && selShapes.length > 0 && tool === 'select' && !textEdit && (
          <div className="align-bar" role="group" aria-label="Selection">
            {selShapes.filter((x) => !isConnector(x)).length > 1 && [['left', '⇤', 'Align left (Alt+A)'], ['hcenter', '↔', 'Align centers (Alt+H)'], ['right', '⇥', 'Align right (Alt+D)'], ['top', '⤒', 'Align top (Alt+W)'], ['vcenter', '↕', 'Align middles (Alt+V)'], ['bottom', '⤓', 'Align bottom (Alt+S)'], ['h', '⋯', 'Distribute horizontally (Shift+Alt+H)'], ['v', '⋮', 'Distribute vertically (Shift+Alt+V)']].map(([how, icon, label]) => (
              <button key={how} onClick={() => align(how)} title={label} aria-label={label}>{icon}</button>
            ))}
            {selected.length > 1 && !isOneGroup && (
              <button onClick={group} title="Group (G)" aria-label="Group selection" className="text-btn">Group</button>
            )}
            {selGroupIds.size > 0 && (
              <button onClick={ungroup} title="Ungroup (Shift+G)" aria-label="Ungroup selection" className="text-btn">Ungroup</button>
            )}
          </div>
        )}

        {!readOnly && <div className="zoom-bar rotate-bar" role="group" aria-label="Rotate">
          <button onClick={() => rotate(-1)} aria-label="Rotate 90° counter-clockwise" title={`Rotate ${selected.length ? 'selection' : 'sketch'} 90° left (Shift+Alt+R)`}>↺</button>
          <button onClick={() => rotate(1)} aria-label="Rotate 90° clockwise" title={`Rotate ${selected.length ? 'selection' : 'sketch'} 90° right (Shift+R)`}>↻</button>
        </div>}

        <div className="zoom-bar" role="group" aria-label="Zoom">
          <button onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
          <button onClick={fitView} className="zoom-level" aria-label="Fit to content" title="Fit to content (0)">{Math.round(z * 100)}%</button>
          <button onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
        </div>

        <footer className="shortcut-help">
          {selected.length > 1 ? `${selected.length} selected · ` : ''}
          
          <kbd>Space</kbd> pan · <kbd>Shift</kbd> multi-select · <kbd>?</kbd> all shortcuts
        </footer>

        {helpOpen && (
          <div className="help-sheet" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setHelpOpen(false)}>
            <div className="help-card" onClick={(e) => e.stopPropagation()}>
              <header>
                <h2>Shortcuts</h2>
                <button className="icon-btn" onClick={() => setHelpOpen(false)} aria-label="Close">✕</button>
              </header>
              <dl>
                {SHORTCUTS.map(([label, keys]) => (
                  <div key={label}><dt>{label}</dt><dd>{keys}</dd></div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </main>

      <AIPanel key={account?.id || 'local'} open={aiOpen && !readOnly} onClose={() => setAiOpen(false)} onShapes={addAIShapes} userId={account?.id || 'local'} />

      {toast && <div className="toast" role="status" ref={toastRef}>{toast}</div>}
    </div>
  );
}
