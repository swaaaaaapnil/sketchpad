import rough from 'roughjs';
import { angleOf, curveControl, fitLabel, getBounds, isCurved, LIGHT_INK, penPath, resolveColor } from '../lib/geometry.js';

const rc = rough.generator();

// Convert a roughjs drawable into SVG path descriptors.
// roughjs 4.x exposes sets of ops: 'path' (outline), 'fillPath' (solid fill), 'fillSketch' (hachure lines).
function toPaths(drawable) {
  const out = [];
  for (const set of drawable.sets) {
    const d = set.ops
      .map((o) => {
        const x = o.data;
        if (o.op === 'move') return `M${x[0]} ${x[1]}`;
        if (o.op === 'bcurveTo') return `C${x[0]} ${x[1]} ${x[2]} ${x[3]} ${x[4]} ${x[5]}`;
        if (o.op === 'lineTo') return `L${x[0]} ${x[1]}`;
        return '';
      })
      .join(' ');
    const o = drawable.options;
    if (set.type === 'fillPath') {
      out.push({ d, stroke: 'none', strokeWidth: 0, fill: o.fill });
    } else if (set.type === 'fillSketch') {
      out.push({ d, stroke: o.fill, strokeWidth: o.fillWeight ?? 1, fill: 'none' });
    } else {
      out.push({ d, stroke: o.stroke, strokeWidth: o.strokeWidth, fill: 'none' });
    }
  }
  return out;
}

function shapePaths(s, dark, onFill) {
  const stroke = resolveColor(s.stroke, dark, onFill);
  const fill = s.fill && s.fill !== 'none' ? resolveColor(s.fill, dark) : undefined;
  const opts = {
    stroke,
    strokeWidth: s.strokeWidth,
    roughness: 1.2,
    bowing: 1,
    seed: s.seed,
    fill,
    fillStyle: 'solid',
  };

  switch (s.type) {
    case 'rect':
      return toPaths(rc.rectangle(s.x, s.y, s.w, s.h, opts));
    case 'ellipse':
      return toPaths(rc.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, opts));
    case 'diamond':
      return toPaths(
        rc.polygon(
          [
            [s.x + s.w / 2, s.y],
            [s.x + s.w, s.y + s.h / 2],
            [s.x + s.w / 2, s.y + s.h],
            [s.x, s.y + s.h / 2],
          ],
          opts,
        ),
      );
    case 'parallelogram': {
      const k = Math.min(s.w * 0.22, s.h * 0.6);
      return toPaths(rc.polygon([[s.x + k, s.y], [s.x + s.w, s.y], [s.x + s.w - k, s.y + s.h], [s.x, s.y + s.h]], opts));
    }
    case 'cylinder': {
      const { x, y, w, h } = s;
      const rx = w / 2, ry = Math.min(h * 0.15, 22);
      const body = `M${x} ${y + ry} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} L${x + w} ${y + h - ry} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} Z`;
      return [...toPaths(rc.path(body, opts)), ...toPaths(rc.path(`M${x + w} ${y + ry} A${rx} ${ry} 0 0 1 ${x} ${y + ry}`, { ...opts, fill: undefined }))];
    }
    case 'document': {
      const { x, y, w, h } = s;
      const d = Math.min(h * 0.12, 14);
      return toPaths(rc.path(`M${x} ${y} L${x + w} ${y} L${x + w} ${y + h - d} C${x + w * 0.7} ${y + h - d * 3} ${x + w * 0.3} ${y + h + d} ${x} ${y + h - d} Z`, opts));
    }
    case 'cloud': {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2, ex = s.w * 0.42, ey = s.h * 0.39, n = 9;
      const pts = Array.from({ length: n }, (_, i) => {
        const t = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        return [cx + ex * Math.cos(t), cy + ey * Math.sin(t)];
      });
      let d = `M${pts[0][0]} ${pts[0][1]}`;
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % n];
        const r = Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.62;
        d += ` A${r} ${r} 0 0 1 ${q[0]} ${q[1]}`;
      });
      return toPaths(rc.path(`${d} Z`, opts));
    }
    case 'sticky': {
      const { x, y, w, h } = s;
      const f = Math.min(w, h) * 0.16;
      return [
        ...toPaths(rc.polygon([[x, y], [x + w, y], [x + w, y + h - f], [x + w - f, y + h], [x, y + h]], { ...opts, roughness: 0.6 })),
        ...toPaths(rc.polygon([[x + w, y + h - f], [x + w - f, y + h - f], [x + w - f, y + h]], { ...opts, roughness: 0.4, fill: 'rgba(0,0,0,0.12)' })),
      ];
    }
    case 'line':
    case 'arrow': {
      // Straight, or a quadratic curve when the bend handle has been dragged.
      const c = isCurved(s) ? curveControl(s) : null;
      const paths = toPaths(c ? rc.path(`M${s.x} ${s.y} Q${c.x} ${c.y} ${s.x2} ${s.y2}`, { ...opts, fill: undefined }) : rc.line(s.x, s.y, s.x2, s.y2, opts));
      if (s.type === 'line') return paths;
      const from = c || { x: s.x, y: s.y };
      const angle = Math.atan2(s.y2 - from.y, s.x2 - from.x) + Math.PI;
      const head = Math.max(12, s.strokeWidth * 5);
      for (const offset of [-0.5, 0.5]) {
        const a = angle + offset;
        paths.push(
          ...toPaths(
            rc.line(s.x2, s.y2, s.x2 + head * Math.cos(a), s.y2 + head * Math.sin(a), opts),
          ),
        );
      }
      return paths;
    }
    case 'pen':
      return [{ d: penPath(s.points, s.strokeWidth * 2), stroke: 'none', fill: stroke, strokeWidth: 0 }];
    default:
      return [];
  }
}

export function ShapeView({ shape, dark, onFill = false, hideLabel = false }) {
  const a = angleOf(shape);
  if (a) {
    const b = getBounds(shape);
    return (
      <g transform={`rotate(${(a * 180) / Math.PI} ${b.x + b.w / 2} ${b.y + b.h / 2})`}>
        <ShapeView shape={{ ...shape, angle: 0 }} dark={dark} onFill={onFill} hideLabel={hideLabel} />
      </g>
    );
  }
  if (shape.type === 'text') {
    return (
      <text
        x={shape.x}
        y={shape.y + (shape.fontSize || 24)}
        fill={resolveColor(shape.stroke, dark, onFill)}
        fontSize={shape.fontSize || 24}
        fontFamily="'Caveat', 'Comic Sans MS', cursive"
        style={{ whiteSpace: 'pre', userSelect: 'none' }}
      >
        {String(shape.text).split('\n').map((line, i) => (
          <tspan key={i} x={shape.x} dy={i === 0 ? 0 : (shape.fontSize || 24) * 1.25}>
            {line || ' '}
          </tspan>
        ))}
      </text>
    );
  }
  return (
    <g>
      {shapePaths(shape, dark, onFill).map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          fill={p.fill}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {shape.label && !hideLabel && <ShapeLabel shape={shape} dark={dark} />}
    </g>
  );
}

/** A box shape's own text: centered, wrapped and shrunk to fit inside it. */
function ShapeLabel({ shape, dark }) {
  const { box, fs, lines } = fitLabel(shape);
  const lh = fs * 1.25;
  const cx = box.x + box.w / 2;
  const top = box.y + box.h / 2 - (lines.length * lh) / 2 + fs * 0.9;
  const filled = shape.fill && shape.fill !== 'none';
  const color = shape.stroke === 'auto' || !shape.stroke ? (filled ? LIGHT_INK : resolveColor('auto', dark)) : resolveColor(shape.stroke, dark, filled);
  return (
    <text x={cx} y={top} fill={color} fontSize={fs} textAnchor="middle" fontFamily="'Caveat', 'Comic Sans MS', cursive" style={{ userSelect: 'none' }}>
      {lines.map((line, i) => (
        <tspan key={i} x={cx} dy={i === 0 ? 0 : lh}>{line || ' '}</tspan>
      ))}
    </text>
  );
}
