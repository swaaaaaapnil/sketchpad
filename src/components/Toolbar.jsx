import { useState } from 'react';

// The rail can scroll sideways on narrow screens, which would clip an absolutely
// positioned popover, so popovers are placed fixed under their button.
const popAt = (btn) => {
  const r = btn.getBoundingClientRect();
  const half = 135;
  return { position: 'fixed', top: r.bottom + 8, left: Math.max(half + 8, Math.min(r.left + r.width / 2, window.innerWidth - half - 8)) };
};
export const TOOLS = [
  { id: 'select', label: 'Select', key: 'V', glyph: '↖' },
  { id: 'rect', label: 'Rectangle', key: 'R', glyph: '▢' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', glyph: '◯' },
  { id: 'diamond', label: 'Diamond', key: 'D', glyph: '◇' },
  { id: 'line', label: 'Line', key: 'L', glyph: '╱' },
  { id: 'arrow', label: 'Arrow', key: 'A', glyph: '→' },
  { id: 'pen', label: 'Pen', key: 'P', glyph: '✎' },
  { id: 'text', label: 'Text', key: 'T', glyph: 'T' },
  { id: 'eraser', label: 'Eraser', key: 'E', glyph: '⌫' },
  { id: 'hand', label: 'Pan', key: 'H', glyph: '✋' },
];

/** Extra shapes, picked from a searchable popover on the rail. */
export const LIBRARY = [
  { id: 'rect', label: 'Rectangle', glyph: '▢', tags: 'box process step square' },
  { id: 'ellipse', label: 'Ellipse', glyph: '◯', tags: 'circle oval start end terminal' },
  { id: 'diamond', label: 'Diamond', glyph: '◇', tags: 'decision condition if branch' },
  { id: 'cylinder', label: 'Cylinder', glyph: '⛁', tags: 'database db storage data' },
  { id: 'document', label: 'Document', glyph: '🗎', tags: 'file page report paper' },
  { id: 'parallelogram', label: 'Parallelogram', glyph: '▱', tags: 'input output io data' },
  { id: 'cloud', label: 'Cloud', glyph: '☁', tags: 'internet service aws network' },
  { id: 'sticky', label: 'Sticky note', glyph: '🗒', tags: 'note post-it memo comment' },
];

function ShapePicker({ tool, onTool }) {
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState('');
  const extra = LIBRARY.find((l) => l.id === tool && !TOOLS.some((t) => t.id === l.id));
  const items = LIBRARY.filter((l) => `${l.label} ${l.tags}`.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (id) => {
    onTool(id);
    setOpen(null);
    setQ('');
  };
  return (
    <div className="shape-picker">
      <button className={`tool-btn ${extra ? 'is-active' : ''}`} onClick={(e) => setOpen(open ? null : popAt(e.currentTarget))} title="More shapes" aria-label="More shapes" aria-expanded={!!open}>
        <span aria-hidden="true">{extra ? extra.glyph : '⬡'}</span>
        <kbd>+</kbd>
      </button>
      {open && (
        <div className="shape-pop" style={open} role="dialog" aria-label="Shape library">
          <input
            autoFocus
            placeholder="Search shapes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(null);
              if (e.key === 'Enter' && items[0]) pick(items[0].id);
              e.stopPropagation();
            }}
          />
          <div className="shape-grid">
            {items.map((l) => (
              <button key={l.id} className={tool === l.id ? 'is-active' : ''} onClick={() => pick(l.id)} title={l.label}>
                <span aria-hidden="true">{l.glyph}</span>
                <small>{l.label}</small>
              </button>
            ))}
            {!items.length && <p className="shape-empty">No shapes match</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function TemplatePicker({ templates, onPick }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="shape-picker">
      <button className="tool-btn" onClick={(e) => setOpen(open ? null : popAt(e.currentTarget))} title="Templates" aria-label="Templates" aria-expanded={!!open}>
        <span aria-hidden="true">▦</span>
      </button>
      {open && (
        <div className="shape-pop template-pop" style={open} role="dialog" aria-label="Templates" onKeyDown={(e) => e.key === 'Escape' && setOpen(null)}>
          <p className="pop-title">Start from a template</p>
          {templates.map((t) => (
            <button key={t.id} className="template-item" onClick={() => { onPick(t); setOpen(null); }}>
              <strong>{t.name}</strong>
              {t.desc && <small>{t.desc}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ToolRail({ tool, onTool, templates, onTemplate }) {
  return (
    <nav className="tool-rail" aria-label="Drawing tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool-btn ${tool === t.id ? 'is-active' : ''}`}
          onClick={() => onTool(t.id)}
          title={`${t.label} (${t.key})`}
          aria-label={t.label}
          aria-pressed={tool === t.id}
        >
          <span aria-hidden="true">{t.glyph}</span>
          <kbd>{t.key}</kbd>
        </button>
      ))}
      <ShapePicker tool={tool} onTool={onTool} />
      {templates && <TemplatePicker templates={templates} onPick={onTemplate} />}
    </nav>
  );
}

const STROKES = ['auto', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5'];
const FILLS = ['none', '#ffec99', '#b2f2bb', '#a5d8ff', '#ffc9c9', '#eebefa'];
const WIDTHS = [1, 2, 4];

export function StylePanel({ style, onStyle }) {
  return (
    <div className="style-panel" aria-label="Style">
      <div className="style-group">
        <span className="label">Stroke</span>
        {STROKES.map((c) => (
          <button
            key={c}
            className={`swatch ${style.stroke === c ? 'is-active' : ''}`}
            style={{ background: c === 'auto' ? 'var(--ink)' : c }}
            onClick={() => onStyle({ stroke: c })}
            aria-label={`Stroke ${c}`}
          />
        ))}
      </div>
      <div className="style-group">
        <span className="label">Fill</span>
        {FILLS.map((c) => (
          <button
            key={c}
            className={`swatch ${style.fill === c ? 'is-active' : ''} ${c === 'none' ? 'is-none' : ''}`}
            style={{ background: c === 'none' ? 'transparent' : c }}
            onClick={() => onStyle({ fill: c })}
            aria-label={c === 'none' ? 'No fill' : `Fill ${c}`}
          />
        ))}
      </div>
      <div className="style-group">
        <span className="label">Width</span>
        {WIDTHS.map((w) => (
          <button
            key={w}
            className={`width-btn ${style.strokeWidth === w ? 'is-active' : ''}`}
            onClick={() => onStyle({ strokeWidth: w })}
            aria-label={`Width ${w}`}
          >
            <span style={{ height: w * 1.5 }} />
          </button>
        ))}
      </div>
    </div>
  );
}
