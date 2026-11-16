import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

const KEY = 'sketchpad.tour';
const NOW = 'sketchpad.tourNow';

/** Ask the next editor that opens to start the tour (used from the home page). */
export function queueTour() {
  try { sessionStorage.setItem(NOW, '1'); } catch { /* storage blocked */ }
}
const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const tool = (label, body) => ({ sel: `.tool-rail [aria-label="${label}"]`, title: label, body });

export const STEPS = [
  { sel: null, title: 'Welcome to Sketchpad', body: 'A quick walk through every button and feature. Use Next and Back, or the arrow keys. Press Esc to stop at any time.' },
  { sel: '.back-btn', title: 'All sketches', body: 'Go back to your list of sketches to open, create or delete boards.' },
  { sel: '.title-input', title: 'Sketch title', body: 'Click to rename this sketch. It saves on its own.' },
  { sel: '.tool-rail', title: 'Drawing tools', body: 'Every tool lives here. Each has a one-key shortcut shown on hover.' },
  tool('Select', 'Pick, move and resize shapes. Drag on empty space to box-select. Shift-click adds to the selection, Alt-drag duplicates.'),
  tool('Rectangle', 'Drag to draw a box, or just click to drop one. Double-click a shape to type a label inside it.'),
  tool('Ellipse', 'Circles and ovals. Hold Shift for a perfect circle.'),
  tool('Diamond', 'Decision shapes for flowcharts.'),
  { sel: '[aria-label="More shapes"]', title: 'Shape library', body: 'Cylinders, documents, clouds, sticky notes and more. Search by name.' },
  { sel: '.tool-rail [aria-label="Templates"]', title: 'Templates', body: 'Start from a ready-made flowchart, user journey, system architecture or retro board. Every piece stays editable.' },
  tool('Line', 'Straight lines. Hold Shift to snap the angle.'),
  tool('Arrow', 'Start or end on a shape and the arrow stays attached when the shape moves.'),
  tool('Pen', 'Freehand drawing.'),
  tool('Text', 'Click anywhere to type free text.'),
  tool('Eraser', 'Drag over shapes to remove them.'),
  tool('Pan', 'Drag to move around the canvas. You can also hold Space, or scroll.'),
  { sel: '.style-panel', title: 'Style panel', body: 'Change stroke colour, fill, line width and more for new shapes or the current selection.' },
  { sel: '[aria-label="Drawing canvas"]', title: 'The canvas', body: `Shapes snap to each other with smart guides (hold ${mod} to drag freely). Select shapes and press ${mod}G to group them, or C to leave a comment on one shape.` },
  { sel: '[aria-label="History"]', title: 'Undo and redo', body: `${mod}Z undoes, ${mod}⇧Z redoes. Other people's edits are never undone by yours.` },
  { sel: '.presence', title: 'Who is here', body: 'People viewing this sketch right now. Their cursors show up live on the canvas.' },
  { sel: '[aria-label="Export"]', title: 'Export', body: 'Save as PNG, SVG or JSON, copy as an image, import a JSON file, or clear the canvas.' },
  { sel: '[aria-label="Share sketch"]', title: 'Share', body: 'Invite people to edit with you, turn on a view-only link, or copy an embed snippet.' },
  { sel: '[aria-label="Draw with AI"]', title: 'Draw with AI', body: 'Describe a diagram in plain words and it is drawn for you, already connected.' },
  { sel: '[aria-label="Toggle dark mode"]', title: 'Dark mode', body: 'Switch between light and dark themes.' },
  { sel: '[aria-label="Keyboard shortcuts"]', title: 'Shortcuts', body: 'See every keyboard shortcut. Press ? to open it anytime.' },
  { sel: '.zoom-bar', title: 'Zoom', body: `Zoom in and out, or fit everything on screen. ${mod} + scroll zooms too.` },
  { sel: null, title: 'One more thing: the command palette', body: `Press ${mod}K to search every action: tools, shapes, templates, align, export, boards. You can restart this tour from there.` },
];

function readSeen() {
  try { return localStorage.getItem(KEY); } catch { return 'err'; }
}
function writeSeen(v) {
  try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ }
}

const visible = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width && r.height ? r : null;
};

/**
 * Bottom-right card inviting people to take the tour. Once dismissed it shrinks to a
 * small pill, so the tour is always one click away, signed in or not.
 */
export function TourLauncher({ onStart }) {
  const [open, setOpen] = useState(() => !readSeen());
  const dismiss = () => { setOpen(false); writeSeen('dismissed'); };
  if (!open) {
    return <button className="tour-pill" onClick={onStart} aria-label="Take a tour">✦ Take a tour</button>;
  }
  return (
    <aside className="tour-prompt" role="dialog" aria-label="Take a tour">
      <button className="tour-x" aria-label="Dismiss" onClick={dismiss}>×</button>
      <strong>New here?</strong>
      <p>Sketchpad has tools for diagrams, sticky notes, templates, live collaboration, comments and AI drawing. Take a one-minute tour of every button and feature. No sign-in needed.</p>
      <div className="tour-actions">
        <button className="ghost-btn small" onClick={dismiss}>Not now</button>
        <button className="primary-btn small" onClick={() => { writeSeen('done'); onStart(); }}>Take a Tour</button>
      </div>
    </aside>
  );
}

export default function Tour({ start, onStarted }) {
  const [step, setStep] = useState(-1);
  const [rect, setRect] = useState(null);
  const [steps, setSteps] = useState(STEPS);

  const begin = useCallback(() => {
    // Skip steps whose element is not on screen (read-only view, hidden panels).
    setSteps(STEPS.filter((s) => !s.sel || visible(document.querySelector(s.sel))));
    setStep(0);
  }, []);

  useEffect(() => {
    if (start) { begin(); onStarted?.(); }
  }, [start, begin, onStarted]);

  // Started from the home page: wait for the editor's entrance animation first.
  useEffect(() => {
    let now = false;
    try { now = sessionStorage.getItem(NOW) === '1'; sessionStorage.removeItem(NOW); } catch { /* storage blocked */ }
    if (!now) return;
    const t = setTimeout(begin, 900);
    return () => clearTimeout(t);
  }, [begin]);

  const end = useCallback(() => setStep(-1), []);
  const cur = step >= 0 ? steps[step] : null;

  useLayoutEffect(() => {
    if (!cur) return;
    const place = () => setRect(cur.sel ? visible(document.querySelector(cur.sel)) : null);
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [cur]);

  useEffect(() => {
    if (!cur) return;
    const onKey = (e) => {
      if (e.key === 'Escape') end();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') setStep((s) => (s + 1 < steps.length ? s + 1 : -1));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cur, steps.length, end]);

  if (step < 0) return <TourLauncher onStart={begin} />;

  const pad = 6;
  const hole = rect && { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  // Tooltip goes beside the target where there is room, else centred.
  let tip = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (hole) {
    const W = 300, vw = window.innerWidth, vh = window.innerHeight;
    const big = hole.width > vw * 0.6 && hole.height > vh * 0.5;
    if (!big) {
      const mid = Math.max(12, Math.min(hole.left + hole.width / 2 - W / 2, vw - W - 12));
      if (hole.left + hole.width + 16 + W < vw) tip = { left: hole.left + hole.width + 16, top: Math.max(12, Math.min(hole.top, vh - 220)) };
      else if (hole.top + hole.height + 220 < vh) tip = { left: mid, top: hole.top + hole.height + 14 };
      else tip = { left: mid, top: hole.top - 14, transform: 'translateY(-100%)' };
    }
  }
  const last = step === steps.length - 1;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tour step ${step + 1} of ${steps.length}`}>
      <div className="tour-shade" onClick={end} />
      {hole ? <div className="tour-hole" style={hole} /> : null}
      <div className="tour-tip" style={tip}>
        <div className="tour-count">{step + 1} / {steps.length}</div>
        <strong>{cur.title}</strong>
        <p>{cur.body}</p>
        <div className="tour-actions">
          <button className="link-btn" onClick={end}>Skip tour</button>
          <span style={{ flex: 1 }} />
          {step > 0 && <button className="ghost-btn small" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="primary-btn small" autoFocus onClick={() => (last ? end() : setStep(step + 1))}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
