import { renderToStaticMarkup } from 'react-dom/server';
import { ShapeView } from '../components/Shapes.jsx';
import { contentBounds, onFillIds } from './geometry.js';

export function buildSVG(shapes, dark) {
  const b = contentBounds(shapes);
  const pad = 40;
  const vb = b
    ? { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }
    : { x: 0, y: 0, w: 800, h: 600 };
  const onFill = onFillIds(shapes);
  const bg = dark ? '#1c1917' : '#fbf8f2';
  const markup = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      width={vb.w}
      height={vb.h}
    >
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={bg} />
      {shapes.map((s) => (
        <ShapeView key={s.id} shape={s} dark={dark} onFill={onFill.has(s.id)} />
      ))}
    </svg>,
  );
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>${markup}`, w: vb.w, h: vb.h };
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSVG(shapes, dark, name = 'sketch') {
  const { svg } = buildSVG(shapes, dark);
  download(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
}

/** Renders the shapes to a 2x PNG blob. */
export function pngBlob(shapes, dark) {
  const { svg, w, h } = buildSVG(shapes, dark);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG failed'))), 'image/png');
    };
    img.onerror = reject;
    img.src = url;
  });
}

export async function exportPNG(shapes, dark, name = 'sketch') {
  download(await pngBlob(shapes, dark), `${name}.png`);
}

/** Copies a 2x PNG of the shapes to the clipboard. */
export async function copyPNG(shapes, dark) {
  // Safari needs the promise handed to ClipboardItem synchronously.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(shapes, dark) })]);
}

export function exportJSON(shapes, dark, name = 'sketch') {
  download(
    new Blob([JSON.stringify({ version: 1, shapes, dark }, null, 2)], { type: 'application/json' }),
    `${name}.json`,
  );
}
