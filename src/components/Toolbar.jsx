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

export function ToolRail({ tool, onTool, locked, onLock }) {
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
      <span className="rail-sep" aria-hidden="true" />
      <button
        className={`tool-btn lock-btn ${locked ? 'is-active' : ''}`}
        onClick={onLock}
        title="Keep tool active after drawing (Q)"
        aria-label="Keep tool active"
        aria-pressed={locked}
      >
        <span aria-hidden="true">{locked ? '🔒' : '🔓'}</span>
        <kbd>Q</kbd>
      </button>
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
