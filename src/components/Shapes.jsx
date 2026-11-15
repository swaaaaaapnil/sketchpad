import rough from 'roughjs';
import { penPath, resolveColor } from '../lib/geometry.js';

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

function shapePaths(s, dark) {
  const stroke = resolveColor(s.stroke, dark);
  const fill = s.fill && s.fill !== 'none' ? resolveColor(s.fill, dark) : undefined;
  const opts = {
    stroke,
    strokeWidth: s.strokeWidth,
    roughness: 1.2,
    bowing: 1,
    seed: s.seed,
    fill,
    fillStyle: 'hachure',
    fillWeight: 1.5,
    hachureGap: 9,
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
    case 'line':
      return toPaths(rc.line(s.x, s.y, s.x2, s.y2, opts));
    case 'arrow': {
      const paths = toPaths(rc.line(s.x, s.y, s.x2, s.y2, opts));
      const angle = Math.atan2(s.y2 - s.y, s.x2 - s.x) + Math.PI;
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

export function ShapeView({ shape, dark }) {
  if (shape.type === 'text') {
    return (
      <text
        x={shape.x}
        y={shape.y + (shape.fontSize || 24)}
        fill={resolveColor(shape.stroke, dark)}
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
      {shapePaths(shape, dark).map((p, i) => (
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
    </g>
  );
}
