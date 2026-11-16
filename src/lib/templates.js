// Starter boards. Coordinates are local (roughly 0..800 x 0..600); arrows bind
// to shapes by id so they follow when things move.
const box = (id, type, x, y, label, extra = {}) => ({ id, type, x, y, w: extra.w || 150, h: extra.h || 80, label, fill: 'none', ...extra });
const arrow = (a, b) => ({ id: `${a}-${b}`, type: 'arrow', x: 0, y: 0, x2: 1, y2: 1, startBind: a, endBind: b, fill: 'none' });
const text = (id, x, y, t, fontSize = 32) => ({ id, type: 'text', x, y, text: t, fontSize, fill: 'none' });

export const TEMPLATES = [
  {
    id: 'flowchart',
    name: 'Flowchart',
    shapes: () => [
      box('s', 'ellipse', 325, 0, 'Start'),
      box('i', 'parallelogram', 315, 130, 'Get input', { w: 170 }),
      box('d', 'diamond', 315, 260, 'Valid?', { w: 170, h: 110 }),
      box('p', 'rect', 325, 430, 'Process'),
      box('e', 'rect', 600, 275, 'Show error'),
      box('db', 'cylinder', 325, 560, 'Save', { h: 100 }),
      arrow('s', 'i'), arrow('i', 'd'), arrow('d', 'p'), arrow('d', 'e'), arrow('e', 'i'), arrow('p', 'db'),
    ],
  },
  {
    id: 'journey',
    name: 'User journey',
    shapes: () => {
      const steps = ['Discover', 'Sign up', 'First use', 'Habit', 'Recommend'];
      const out = [text('t', 0, -70, 'User journey')];
      steps.forEach((s, i) => {
        out.push(box(`j${i}`, 'rect', i * 200, 0, s));
        out.push(box(`n${i}`, 'sticky', i * 200, 130, 'Feeling / pain point', { w: 150, h: 150, fontSize: 18 }));
        if (i) out.push(arrow(`j${i - 1}`, `j${i}`));
      });
      return out;
    },
  },
  {
    id: 'architecture',
    name: 'System architecture',
    shapes: () => [
      box('u', 'ellipse', 0, 200, 'Users'),
      box('cdn', 'cloud', 210, 180, 'CDN', { w: 170, h: 120 }),
      box('web', 'rect', 440, 100, 'Web app'),
      box('api', 'rect', 440, 300, 'API'),
      box('q', 'parallelogram', 680, 400, 'Queue'),
      box('db', 'cylinder', 680, 180, 'Database', { h: 110 }),
      box('w', 'rect', 900, 400, 'Workers'),
      arrow('u', 'cdn'), arrow('cdn', 'web'), arrow('web', 'api'), arrow('api', 'db'), arrow('api', 'q'), arrow('q', 'w'), arrow('w', 'db'),
    ],
  },
  {
    id: 'retro',
    name: 'Retro',
    shapes: () => {
      const cols = [['Went well', '#b2f2bb'], ['To improve', '#ffc9c9'], ['Action items', '#a5d8ff']];
      const out = [text('t', 0, -80, 'Sprint retro')];
      cols.forEach(([name, fill], c) => {
        out.push(box(`h${c}`, 'rect', c * 300, 0, name, { w: 260, h: 60, fill }));
        for (let r = 0; r < 2; r++) out.push(box(`s${c}${r}`, 'sticky', c * 300 + 50, 90 + r * 190, 'Add a note', { w: 160, h: 160, fill, fontSize: 18 }));
      });
      return out;
    },
  },
];
