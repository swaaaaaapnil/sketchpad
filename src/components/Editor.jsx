import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ShapeView } from './Shapes.jsx';
import { ToolRail, StylePanel } from './Toolbar.jsx';
import AIPanel from './AIPanel.jsx';
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
  routeConnectors,
  scaleShape,
  shapesInRect,
  translateShape,
} from '../lib/geometry.js';
import { exportJSON, exportPNG, exportSVG } from '../lib/export.jsx';
import { backendName, getBoard, saveBoard } from '../lib/store.js';

gsap.registerPlugin(useGSAP);

const HIT_PX = 6;
const HANDLE_PX = 7;
const BIND_PX = 14; // how close (screen px) an arrow end must come to a shape to snap onto it
const KEY_TOOLS = { v: 'select', r: 'rect', o: 'ellipse', d: 'diamond', l: 'line', a: 'arrow', p: 'pen', t: 'text', e: 'eraser', h: 'hand' };
const STICKY = new Set(['pen', 'eraser', 'hand']); // stay active without the lock
const HANDLE_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', p1: 'move', p2: 'move', mid: 'grab' };
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

function relTime(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return new Date(iso).toLocaleString();
}

export default function Editor({ boardId, dark, setDark, onHome }) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('Untitled sketch');
  const [shapes, setShapes] = useState([]);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [tool, setTool] = useState('select');
  const [locked, setLocked] = useState(false);
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [selected, setSelected] = useState([]);
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 });
  const [draft, setDraft] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [bindHint, setBindHint] = useState(null); // id of the shape an arrow end will snap to
  const [textEdit, setTextEdit] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [hoverCursor, setHoverCursor] = useState(null);
  const [toast, setToast] = useState('');
  const [save, setSave] = useState({ state: 'idle', at: null });

  const rootRef = useRef(null);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const importRef = useRef(null);
  const toastRef = useRef(null);
  const pending = useRef(null);
  const camRef = useRef(cam);
  camRef.current = cam;

  /* ---------- load + autosave ---------- */

  useEffect(() => {
    let alive = true;
    getBoard(boardId)
      .then((b) => {
        if (!alive) return;
        if (!b) return setLoadError('This sketch does not exist, or it was deleted.');
        setTitle(b.title);
        setShapes(Array.isArray(b.shapes) ? b.shapes : []);
        setSave({ state: 'saved', at: b.updated_at });
        setLoaded(true);
      })
      .catch((e) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [boardId]);

  // Center the view on content once loaded.
  useEffect(() => {
    if (loaded) requestAnimationFrame(() => fitView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const flush = useCallback(async () => {
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    clearTimeout(job.timer);
    setSave((s) => ({ ...s, state: 'saving' }));
    try {
      const row = await saveBoard(boardId, job.patch);
      setSave({ state: 'saved', at: row.updated_at });
    } catch (e) {
      setSave((s) => ({ ...s, state: 'error', message: e.message }));
    }
  }, [boardId]);

  useEffect(() => {
    if (!loaded) return;
    if (pending.current) clearTimeout(pending.current.timer);
    const job = { patch: { shapes, title: title.trim() || 'Untitled sketch', dark }, timer: null };
    job.timer = setTimeout(flush, 700);
    pending.current = job;
    setSave((s) => (s.state === 'error' ? s : { ...s, state: 'dirty' }));
  }, [shapes, title, dark, loaded, flush]);

  // Save before the tab closes and when leaving the editor.
  useEffect(() => {
    const onUnload = () => pending.current && flush();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      flush();
    };
  }, [flush]);

  async function goHome() {
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
    setPast((p) => [...p.slice(-99), before]);
    setFuture([]);
    setShapes(routeConnectors(next));
  }, []);

  const undo = () => {
    if (!past.length) return say('Nothing to undo');
    setFuture((f) => [shapes, ...f]);
    setShapes(past[past.length - 1]);
    setPast(past.slice(0, -1));
    setSelected([]);
  };

  const redo = () => {
    if (!future.length) return say('Nothing to redo');
    setPast((p) => [...p, shapes]);
    setShapes(future[0]);
    setFuture(future.slice(1));
    setSelected([]);
  };

  const selSet = new Set(selected);
  const selShapes = shapes.filter((s) => selSet.has(s.id));

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
  const selBox = selShapes.length ? contentBounds(selShapes) : null;

  function handlePoints() {
    if (!selBox || tool !== 'select' || textEdit) return [];
    if (isLine) {
      const m = curveMid(single);
      return [['p1', single.x, single.y], ['p2', single.x2, single.y2], ['mid', m.x, m.y]];
    }
    const { x, y, w, h } = selBox;
    const corners = [['nw', x, y], ['ne', x + w, y], ['se', x + w, y + h], ['sw', x, y + h]];
    if (single?.type === 'text') return corners;
    return [...corners, ['n', x + w / 2, y], ['e', x + w, y + h / 2], ['s', x + w / 2, y + h], ['w', x, y + h / 2]];
  }

  function handleAt(p) {
    const tol = HANDLE_PX / cam.z;
    return handlePoints().find(([, hx, hy]) => Math.abs(p.x - hx) <= tol && Math.abs(p.y - hy) <= tol)?.[0] ?? null;
  }

  /* ---------- pointer ---------- */

  function capture(e) {
    svgRef.current.setPointerCapture(e.pointerId);
  }

  function onPointerDown(e) {
    if (textEdit) return; // blur of the text box commits it first
    setExportOpen(false);
    if (e.button === 1 || spaceHeld || tool === 'hand') {
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, cam0: cam };
      return capture(e);
    }
    if (e.button !== 0) return;
    const p = toWorld(e);

    if (tool === 'text') {
      const hit = hitTest(shapes, p.x, p.y, HIT_PX / cam.z);
      if (hit?.type === 'text') return startTextEdit(hit);
      e.preventDefault();
      return startTextEdit(null, p);
    }

    if (tool === 'eraser') {
      drag.current = { mode: 'erase', before: shapes, latest: shapes };
      eraseAt(p, drag.current);
      return capture(e);
    }

    if (tool === 'select') {
      const handle = handleAt(p);
      if (handle) {
        drag.current = isLine
          ? { mode: handle === 'mid' ? 'bend' : 'endpoint', id: single.id, which: handle, before: shapes, latest: shapes }
          : { mode: 'resize', handle, box0: selBox, origs: new Map(selShapes.map((s) => [s.id, s])), before: shapes, latest: shapes };
        return capture(e);
      }

      const hit = hitTest(shapes, p.x, p.y, HIT_PX / cam.z);
      if (hit) {
        let ids;
        if (e.shiftKey) {
          ids = selSet.has(hit.id) ? selected.filter((id) => id !== hit.id) : [...selected, hit.id];
          setSelected(ids);
          if (!ids.includes(hit.id)) return;
        } else {
          ids = selSet.has(hit.id) ? selected : [hit.id];
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
    const d = drag.current;
    if (!d) {
      if (tool === 'select' && !spaceHeld) {
        const p = toWorld(e);
        const h = handleAt(p);
        setHoverCursor(h ? HANDLE_CURSOR[h] : hitTest(shapes, p.x, p.y, HIT_PX / cam.z) ? 'move' : null);
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
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * cam.z < 2) return;
      d.moved = true;
      const byId = new Map(d.origs.map((s) => [s.id, translateShape(s, dx, dy)]));
      d.latest = routeConnectors(detachMoved(d.before.map((s) => byId.get(s.id) ?? s), d.set));
      setShapes(d.latest);
      return;
    }

    if (d.mode === 'resize') {
      const nb = resizeBox(d.box0, d.handle, p, e.shiftKey);
      d.latest = routeConnectors(d.before.map((s) => (d.origs.has(s.id) ? scaleShape(d.origs.get(s.id), d.box0, nb) : s)));
      setShapes(d.latest);
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
      const inside = shapesInRect(shapes, rect);
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
    if (!d) return;

    if (d.mode === 'move') {
      if (d.moved) commit(d.base, d.latest);
      else if (d.before !== d.base) setShapes(d.base); // alt-click without drag: drop the copy
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
      const s = d.draft;
      setDraft(null);
      if (isTrivial(s)) return;
      commit(d.before, [...d.before, s]);
      if (!locked && !STICKY.has(tool)) {
        setTool('select');
        setSelected([s.id]);
      }
    }
  }

  function onDoubleClick(e) {
    if (tool !== 'select' && tool !== 'text') return;
    const p = toWorld(e);
    const hit = hitTest(shapes, p.x, p.y, HIT_PX / cam.z);
    if (hit?.type === 'text') return startTextEdit(hit);
    if (hit && ['rect', 'ellipse', 'diamond'].includes(hit.type)) {
      // Label a box: start text near its center.
      return startTextEdit(null, { x: hit.x + hit.w / 2 - 30, y: hit.y + hit.h / 2 - 15 });
    }
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

  function finishText(keep) {
    const t = textEdit;
    if (!t) return;
    setTextEdit(null);
    if (!keep) return;
    const value = t.value.replace(/\s+$/, '');
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
    if (!locked) setTool('select');
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
    const made = list.map((s) => ({
      ...DEFAULT_STYLE,
      ...s,
      id: makeId(),
      seed: Math.floor(Math.random() * 100000),
      strokeWidth: 2,
      x: s.x + ox,
      y: s.y + oy,
      x2: s.x2 + ox,
      y2: s.y2 + oy,
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
      if (e.key === '?') return setHelpOpen((o) => !o);
      if (e.key === ']') return reorder(true);
      if (e.key === '[') return reorder(false);
      if (k === 'q') return setLocked((l) => !l);
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

  const cursor = drag.current?.mode === 'pan' ? 'grabbing'
    : spaceHeld || tool === 'hand' ? 'grab'
    : tool === 'select' ? hoverCursor || 'default'
    : tool === 'text' ? 'text'
    : tool === 'eraser' ? 'cell' : 'crosshair';

  const z = cam.z;
  const saveLabel = {
    idle: '',
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    saved: `Saved ${relTime(save.at)}`,
    error: 'Not saved — retrying on next change',
  }[save.state];

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
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label="Sketch title"
              spellCheck={false}
            />
            <span className={`save-state is-${save.state}`} title={save.message || ''}>
              <i aria-hidden="true" />
              {saveLabel}
              <em>{backendName === 'supabase' ? ' · cloud' : ' · this browser'}</em>
            </span>
          </div>
        </div>

        <ToolRail
          tool={tool}
          onTool={(t) => {
            setTool(t);
            if (t !== 'select') setSelected([]);
          }}
          locked={locked}
          onLock={() => setLocked((l) => !l)}
        />

        <div className="top-actions">
          <div className="btn-pair" role="group" aria-label="History">
            <button className="icon-btn" onClick={undo} disabled={!past.length} title="Undo (⌘Z)" aria-label="Undo">↶</button>
            <button className="icon-btn" onClick={redo} disabled={!future.length} title="Redo (⇧⌘Z)" aria-label="Redo">↷</button>
          </div>
          <div className="menu-wrap">
            <button className="ghost-btn" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}>Export</button>
            {exportOpen && (
              <div className="menu" role="menu">
                <p className="menu-note">{selShapes.length ? `Selection · ${selShapes.length} shape${selShapes.length > 1 ? 's' : ''}` : 'Whole canvas'}</p>
                <button role="menuitem" onClick={() => doExport('png')}>PNG image</button>
                <button role="menuitem" onClick={() => doExport('svg')}>SVG vector</button>
                <button role="menuitem" onClick={() => doExport('json')}>JSON (editable)</button>
                <hr />
                <button role="menuitem" onClick={() => { importRef.current.click(); setExportOpen(false); }}>Import JSON…</button>
                <button role="menuitem" className="danger" onClick={() => { clearAll(); setExportOpen(false); }}>Clear canvas</button>
              </div>
            )}
            <input ref={importRef} type="file" accept="application/json" hidden onChange={onImportFile} />
          </div>
          <button className="icon-btn" onClick={() => setHelpOpen((o) => !o)} aria-label="Keyboard shortcuts" title="Shortcuts (?)">?</button>
          <button className="icon-btn" onClick={() => setDark((d) => !d)} aria-label="Toggle dark mode" title="Toggle theme">{dark ? '☾' : '☀'}</button>
          <button className="primary-btn small ai-btn" onClick={() => setAiOpen((o) => !o)} aria-expanded={aiOpen} aria-label="Draw with AI">✦<span> Draw with AI</span></button>
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
          onPointerLeave={() => setHoverCursor(null)}
          onDoubleClick={onDoubleClick}
          role="img"
          aria-label="Drawing canvas"
        >
          <g className="scene" transform={`translate(${cam.x} ${cam.y}) scale(${z})`}>
            {shapes.map((s) => (textEdit?.id === s.id ? null : <ShapeView key={s.id} shape={s} dark={dark} onFill={onFill.has(s.id)} />))}
            {draft && <ShapeView shape={draft} dark={dark} onFill={draft.type === 'pen' && draft.stroke === 'auto' && draft.points.length > 0 && pointOnFill(shapes, draft.points[0][0], draft.points[0][1])} />}

            {selShapes.length > 1 &&
              selShapes.map((s) => {
                const b = getBounds(s);
                return <rect key={s.id} x={b.x} y={b.y} width={b.w} height={b.h} className="sel-each" strokeWidth={1 / z} pointerEvents="none" />;
              })}

            {selBox && !textEdit && !isLine && (
              <rect
                x={selBox.x - 4 / z}
                y={selBox.y - 4 / z}
                width={selBox.w + 8 / z}
                height={selBox.h + 8 / z}
                className="sel-box"
                strokeWidth={1.5 / z}
                strokeDasharray={`${5 / z} ${4 / z}`}
                rx={6 / z}
                pointerEvents="none"
              />
            )}
            {handlePoints().map(([id, hx, hy]) => (
              <rect
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
          </g>
        </svg>

        {textEdit && (
          <textarea
            className="text-input"
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
            style={{
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

        {tool !== 'hand' && tool !== 'eraser' && <StylePanel style={shownStyle} onStyle={applyStyle} />}

        <div className="zoom-bar" role="group" aria-label="Zoom">
          <button onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
          <button onClick={fitView} className="zoom-level" aria-label="Fit to content" title="Fit to content (0)">{Math.round(z * 100)}%</button>
          <button onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
        </div>

        <footer className="shortcut-help">
          {selected.length > 1 ? `${selected.length} selected · ` : ''}
          {locked && tool !== 'select' ? <><b>{tool}</b> locked · </> : ''}
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

      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} onShapes={addAIShapes} />

      {toast && <div className="toast" role="status" ref={toastRef}>{toast}</div>}
    </div>
  );
}
