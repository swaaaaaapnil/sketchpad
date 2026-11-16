// Smart guides: while dragging, snap the moving box to other shapes' edges and
// centres, and hint when it sits at an equal gap between two neighbours.
import { getBounds, isConnector } from './geometry.js';

const unionBox = (shapes) => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const s of shapes) {
    const b = getBounds(s);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};

/** Returns the snapped offset and the guide lines to draw. */
export function snapMove(moving, others, dx, dy, tol) {
  const b0 = unionBox(moving);
  const targets = others.filter((s) => !isConnector(s) && s.type !== 'pen').map(getBounds);
  if (!targets.length || !isFinite(b0.x)) return { dx, dy, guides: [] };
  const b = { ...b0, x: b0.x + dx, y: b0.y + dy };
  const xs = [b.x, b.x + b.w / 2, b.x + b.w];
  const ys = [b.y, b.y + b.h / 2, b.y + b.h];
  let bestX = null, bestY = null;
  for (const t of targets) {
    const tx = [t.x, t.x + t.w / 2, t.x + t.w];
    const ty = [t.y, t.y + t.h / 2, t.y + t.h];
    for (const a of xs) for (const v of tx) {
      const d = v - a;
      if (Math.abs(d) <= tol && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, v };
    }
    for (const a of ys) for (const v of ty) {
      const d = v - a;
      if (Math.abs(d) <= tol && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, v };
    }
  }
  // Equal spacing between the nearest left/right (or above/below) neighbours.
  const gapHint = [];
  const eq = (axis) => {
    const [p, s] = axis === 'x' ? ['x', 'w'] : ['y', 'h'];
    const [q, r] = axis === 'x' ? ['y', 'h'] : ['x', 'w'];
    const bb = { ...b, x: b.x + (axis === 'x' ? 0 : bestX?.d || 0), y: b.y + (axis === 'y' ? 0 : bestY?.d || 0) };
    const lane = targets.filter((t) => t[q] < bb[q] + bb[r] && t[q] + t[r] > bb[q]);
    const before = lane.filter((t) => t[p] + t[s] <= bb[p] + tol).sort((m, n) => n[p] + n[s] - (m[p] + m[s]))[0];
    const after = lane.filter((t) => t[p] >= bb[p] + bb[s] - tol).sort((m, n) => m[p] - n[p])[0];
    if (!before || !after) return null;
    const space = after[p] - (before[p] + before[s]) - bb[s];
    if (space <= 0) return null;
    const want = before[p] + before[s] + space / 2;
    const d = want - bb[p];
    if (Math.abs(d) > tol) return null;
    const mid = bb[q] + bb[r] / 2;
    const seg = (a1, a2) => (axis === 'x' ? { x1: a1, y1: mid, x2: a2, y2: mid, gap: true } : { x1: mid, y1: a1, x2: mid, y2: a2, gap: true });
    gapHint.push(seg(before[p] + before[s], want), seg(want + bb[s], after[p]));
    return d;
  };
  const ex = bestX ? null : eq('x');
  const ey = bestY ? null : eq('y');
  const sx = bestX ? bestX.d : ex ?? 0;
  const sy = bestY ? bestY.d : ey ?? 0;
  const fb = { x: b.x + sx, y: b.y + sy, w: b.w, h: b.h };
  const guides = [...gapHint];
  const span = (v, axis) => {
    const hits = targets.filter((t) => (axis === 'x' ? [t.x, t.x + t.w / 2, t.x + t.w] : [t.y, t.y + t.h / 2, t.y + t.h]).some((u) => Math.abs(u - v) < 0.5));
    const all = [...hits, fb];
    if (axis === 'x') guides.push({ x1: v, x2: v, y1: Math.min(...all.map((t) => t.y)) - 8, y2: Math.max(...all.map((t) => t.y + t.h)) + 8 });
    else guides.push({ y1: v, y2: v, x1: Math.min(...all.map((t) => t.x)) - 8, x2: Math.max(...all.map((t) => t.x + t.w)) + 8 });
  };
  if (bestX) span(bestX.v, 'x');
  if (bestY) span(bestY.v, 'y');
  return { dx: dx + sx, dy: dy + sy, guides };
}
