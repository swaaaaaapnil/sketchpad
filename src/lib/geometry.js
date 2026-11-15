import { getStroke } from 'perfect-freehand';

export const DEFAULT_STYLE = { stroke: 'auto', fill: 'none', strokeWidth: 2, fontSize: 24 };

export function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export function resolveColor(color, dark) {
  if (color === 'auto') return dark ? '#f5f0e8' : '#1c1917';
  return color;
}

export function getBounds(s) {
  if (s.type === 'pen') {
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    const pad = s.strokeWidth * 2;
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      x: minX - pad,
      y: minY - pad,
      w: Math.max(...xs) - minX + pad * 2,
      h: Math.max(...ys) - minY + pad * 2,
    };
  }
  if (s.type === 'line' || s.type === 'arrow') {
    return {
      x: Math.min(s.x, s.x2),
      y: Math.min(s.y, s.y2),
      w: Math.abs(s.x2 - s.x),
      h: Math.abs(s.y2 - s.y),
    };
  }
  if (s.type === 'text') {
    const fs = s.fontSize || 24;
    const lines = String(s.text).split('\n').length;
    return { x: s.x, y: s.y, w: textWidth(s.text, fs), h: fs * 1.25 * lines };
  }
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

export function contentBounds(shapes) {
  if (!shapes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    const b = getBounds(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function nearPolyline(pts, x, y, tol, closed) {
  const n = pts.length;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (distToSegment(x, y, a[0], a[1], b[0], b[1]) <= tol) return true;
  }
  return false;
}

/** True when (x, y) touches the shape: its outline, or its inside when filled or text. */
export function shapeContains(s, x, y, tol) {
  const filled = s.fill && s.fill !== 'none';
  const t = tol + (s.strokeWidth || 2) / 2;
  switch (s.type) {
    case 'line':
    case 'arrow':
      return distToSegment(x, y, s.x, s.y, s.x2, s.y2) <= t;
    case 'pen':
      return s.points.length === 1
        ? Math.hypot(x - s.points[0][0], y - s.points[0][1]) <= t + s.strokeWidth
        : nearPolyline(s.points, x, y, t + s.strokeWidth, false);
    case 'text': {
      const b = getBounds(s);
      return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
    }
    case 'ellipse': {
      const rx = s.w / 2, ry = s.h / 2;
      if (rx < 1 || ry < 1) return false;
      const cx = s.x + rx, cy = s.y + ry;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry); // 1 on the outline
      const edge = Math.abs(d - 1) * Math.min(rx, ry) <= t;
      return edge || (filled && d < 1);
    }
    case 'diamond': {
      const pts = [[s.x + s.w / 2, s.y], [s.x + s.w, s.y + s.h / 2], [s.x + s.w / 2, s.y + s.h], [s.x, s.y + s.h / 2]];
      if (nearPolyline(pts, x, y, t, true)) return true;
      if (!filled) return false;
      const nx = Math.abs(x - (s.x + s.w / 2)) / (s.w / 2 || 1);
      const ny = Math.abs(y - (s.y + s.h / 2)) / (s.h / 2 || 1);
      return nx + ny <= 1;
    }
    default: {
      const pts = [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
      if (nearPolyline(pts, x, y, t, true)) return true;
      return filled && x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
    }
  }
}

/** Topmost shape under the point. */
export function hitTest(shapes, x, y, tol) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (shapeContains(shapes[i], x, y, tol)) return shapes[i];
  }
  return null;
}

/** Ids of shapes fully inside a marquee rectangle. */
export function shapesInRect(shapes, r) {
  const x1 = Math.min(r.x, r.x + r.w), y1 = Math.min(r.y, r.y + r.h);
  const x2 = Math.max(r.x, r.x + r.w), y2 = Math.max(r.y, r.y + r.h);
  return shapes
    .filter((s) => {
      const b = getBounds(s);
      return b.x >= x1 && b.y >= y1 && b.x + b.w <= x2 && b.y + b.h <= y2;
    })
    .map((s) => s.id);
}

/** Resize a shape by mapping its bounds from box `from` to box `to`. */
export function scaleShape(s, from, to) {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  const mx = (v) => to.x + (v - from.x) * sx;
  const my = (v) => to.y + (v - from.y) * sy;
  if (s.type === 'pen') return { ...s, points: s.points.map(([px, py, pr]) => [mx(px), my(py), pr]) };
  if (s.type === 'line' || s.type === 'arrow') return { ...s, x: mx(s.x), y: my(s.y), x2: mx(s.x2), y2: my(s.y2) };
  if (s.type === 'text') {
    const fs = Math.max(8, Math.round((s.fontSize || 24) * Math.max(0.1, Math.abs(sy))));
    return { ...s, x: mx(s.x), y: my(s.y), fontSize: fs };
  }
  const x1 = mx(s.x), x2 = mx(s.x + s.w), y1 = my(s.y), y2 = my(s.y + s.h);
  return { ...s, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/** New bounds when dragging handle `h` (nw, n, ne, e, se, s, sw, w) to point p. */
export function resizeBox(box, h, p, keepRatio) {
  let x1 = box.x, y1 = box.y, x2 = box.x + box.w, y2 = box.y + box.h;
  if (h.includes('w')) x1 = p.x;
  if (h.includes('e')) x2 = p.x;
  if (h.includes('n')) y1 = p.y;
  if (h.includes('s')) y2 = p.y;
  if (keepRatio && h.length === 2 && box.w && box.h) {
    const ratio = box.w / box.h;
    const w = x2 - x1, hh = y2 - y1;
    if (Math.abs(w / ratio) > Math.abs(hh)) {
      const nh = Math.sign(hh || 1) * Math.abs(w / ratio);
      if (h.includes('n')) y1 = y2 - nh; else y2 = y1 + nh;
    } else {
      const nw = Math.sign(w || 1) * Math.abs(hh * ratio);
      if (h.includes('w')) x1 = x2 - nw; else x2 = x1 + nw;
    }
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function textWidth(text, fs) {
  const lines = String(text).split('\n');
  return Math.max(20, ...lines.map((l) => l.length * fs * 0.48));
}

export function translateShape(s, dx, dy) {
  if (s.type === 'pen') return { ...s, points: s.points.map(([px, py]) => [px + dx, py + dy]) };
  if (s.type === 'line' || s.type === 'arrow') {
    return { ...s, x: s.x + dx, y: s.y + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  }
  return { ...s, x: s.x + dx, y: s.y + dy };
}

export function duplicateShape(s, offset = 24) {
  return translateShape({ ...s, id: makeId() }, offset, offset);
}

export function createShape(type, p, style) {
  const base = {
    id: makeId(),
    type,
    ...style,
    seed: Math.floor(Math.random() * 100000),
    x: p.x,
    y: p.y,
    w: 0,
    h: 0,
  };
  if (type === 'line' || type === 'arrow') return { ...base, x2: p.x, y2: p.y };
  if (type === 'pen') return { ...base, points: [[p.x, p.y]] };
  return base;
}

export function penPath(points, size) {
  const outline = getStroke(points, {
    size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  });
  if (!outline.length) return '';
  return (
    outline.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ') + ' Z'
  );
}

export function isTrivial(s) {
  if (s.type === 'pen') return s.points.length < 2;
  if (s.type === 'line' || s.type === 'arrow') return Math.hypot(s.x2 - s.x, s.y2 - s.y) < 3;
  return s.w < 3 && s.h < 3;
}
