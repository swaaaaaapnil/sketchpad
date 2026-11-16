// Pure helpers for live collaboration. A change set ("ops") is
//   { up: shape[], del: id[], ord: id[] | null, title?: string, dark?: boolean }
// Shapes are matched by id, so two people editing different shapes never collide;
// on the same shape the most recent change wins.

const sameShape = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
export const orderKey = (shapes) => shapes.map((s) => s.id).join('|');

/** What changed between the last synced state (base) and the current shapes. */
export function diffShapes(base, baseOrder, shapes) {
  const up = [];
  const seen = new Set();
  for (const s of shapes) {
    seen.add(s.id);
    const was = base.get(s.id);
    if (!was || !sameShape(was, s)) up.push(s);
  }
  const del = [];
  for (const id of base.keys()) if (!seen.has(id)) del.push(id);
  const key = orderKey(shapes);
  const ord = key !== baseOrder ? shapes.map((s) => s.id) : null;
  return { up, del, ord, key };
}

export const emptyOps = () => ({ up: new Map(), del: new Set(), ord: null, title: undefined, dark: undefined });
export const hasOps = (o) => o.up.size || o.del.size || o.ord || o.title !== undefined || o.dark !== undefined;

/** Folds a newer change set into an accumulated one (newer wins). */
export function addOps(acc, { up = [], del = [], ord = null, title, dark }) {
  for (const s of up) {
    acc.up.set(s.id, s);
    acc.del.delete(s.id);
  }
  for (const id of del) {
    acc.up.delete(id);
    acc.del.add(id);
  }
  if (ord) acc.ord = ord;
  if (title !== undefined) acc.title = title;
  if (dark !== undefined) acc.dark = dark;
  return acc;
}

/** Puts an older, unsaved change set back under the newer one (after a failed save). */
export function restoreOps(acc, older) {
  for (const [id, s] of older.up) if (!acc.up.has(id) && !acc.del.has(id)) acc.up.set(id, s);
  for (const id of older.del) if (!acc.up.has(id)) acc.del.add(id);
  if (!acc.ord && older.ord) acc.ord = older.ord;
  if (acc.title === undefined) acc.title = older.title;
  if (acc.dark === undefined) acc.dark = older.dark;
  return acc;
}

export const opsToWire = (o) => ({ up: [...o.up.values()], del: [...o.del], ord: o.ord, title: o.title, dark: o.dark });

/** Applies a change set to a shapes array, keeping positions of shapes that stay. */
export function applyOps(shapes, { up = [], del = [], ord = null }) {
  if (!up.length && !del.length && !ord) return shapes;
  const ups = new Map(up.map((s) => [s.id, s]));
  const dels = new Set(del);
  const next = [];
  for (const s of shapes) {
    if (dels.has(s.id)) continue;
    if (ups.has(s.id)) {
      next.push(ups.get(s.id));
      ups.delete(s.id);
    } else next.push(s);
  }
  for (const s of ups.values()) if (!dels.has(s.id)) next.push(s);
  if (!ord) return next;
  const at = new Map(ord.map((id, i) => [id, i]));
  return next
    .map((s, i) => [s, at.has(s.id) ? at.get(s.id) : ord.length + i])
    .sort((a, b) => a[1] - b[1])
    .map(([s]) => s);
}

/**
 * Undo/redo restores a snapshot, but must not wipe out other people's edits made
 * since then: shapes touched by someone else after `since` keep their current state.
 */
export function rebaseSnapshot(target, current, touched, since) {
  const recent = new Set();
  for (const [id, at] of touched) if (at > since) recent.add(id);
  if (!recent.size) return target;
  const now = new Map(current.map((s) => [s.id, s]));
  const out = [];
  const placed = new Set();
  for (const s of target) {
    if (!recent.has(s.id)) out.push(s);
    else if (now.has(s.id)) {
      out.push(now.get(s.id));
      placed.add(s.id);
    }
    // touched and now gone: someone else deleted it, keep it deleted
  }
  for (const s of current) if (recent.has(s.id) && !placed.has(s.id)) out.push(s);
  return out;
}

/** Splits a large change set so each broadcast message stays well under Realtime's size limit. */
export function chunkOps(wire, maxBytes = 120000) {
  const size = JSON.stringify(wire).length;
  if (size <= maxBytes) return [wire];
  const chunks = [];
  let cur = { up: [], del: wire.del, ord: null, title: wire.title, dark: wire.dark };
  let bytes = 0;
  for (const s of wire.up) {
    const n = JSON.stringify(s).length;
    if (bytes + n > maxBytes && cur.up.length) {
      chunks.push(cur);
      cur = { up: [], del: [], ord: null };
      bytes = 0;
    }
    cur.up.push(s);
    bytes += n;
  }
  cur.ord = wire.ord; // order last, once every shape has arrived
  chunks.push(cur);
  return chunks;
}
