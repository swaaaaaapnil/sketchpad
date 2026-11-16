import { useEffect, useMemo, useRef, useState } from 'react';

/** ⌘K palette: fuzzy-ish search over every action, shape, template and board. */
export default function CommandPalette({ items, onClose }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = useRef(null);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((it) => {
      const hay = `${it.group} ${it.label} ${it.keywords || ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    }).slice(0, 60);
  }, [q, items]);
  useEffect(() => list.current?.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' }), [i]);
  const run = (it) => {
    onClose();
    it?.run();
  };
  return (
    <div className="cmdk-backdrop" onPointerDown={onClose}>
      <div className="cmdk" role="dialog" aria-label="Command palette" onPointerDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Type a command, shape, template or board…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(n + 1, shown.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => Math.max(n - 1, 0)); }
            if (e.key === 'Enter') run(shown[i]);
          }}
        />
        <ul ref={list}>
          {shown.map((it, n) => (
            <li key={it.id} className={n === i ? 'is-on' : ''} onPointerEnter={() => setI(n)} onClick={() => run(it)}>
              <span className="cmdk-group">{it.group}</span>
              <span className="cmdk-label">{it.label}</span>
              {it.hint && <kbd>{it.hint}</kbd>}
            </li>
          ))}
          {!shown.length && <li className="cmdk-empty">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
