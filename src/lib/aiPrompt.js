// The fixed prompt template every AI request goes through. The user's text is
// only ever inserted inside <request> tags; the rules around it stay the same,
// so the reply is always a workflow graph the app can lay out.

export const SYSTEM_PROMPT = `You are the diagram planner inside a hand-drawn whiteboard app.
You turn any request into a WORKFLOW: a set of steps (nodes) joined by arrows (edges).
You never draw, position, size or nest anything. The app does all layout.
You always answer by returning one JSON object that matches the workflow schema, and nothing else.`;

export function buildUserPrompt(request) {
  const clean = String(request || '').replace(/<\/?request>/gi, '').trim().slice(0, 2000);
  return `Turn the request below into a workflow diagram.

<request>
${clean}
</request>

How to build the workflow:
1. Read the request as a process. If it describes screens, UI parts or a system, model the journey or data flow through them, not their visual layout. Example: "login page with username, password and submit" becomes Start → Login page → Enter credentials → Valid? → Dashboard.
2. Begin with one "ellipse" node for the start (e.g. "Start", "User visits") and end each finished path with an "ellipse" node (e.g. "Done", "Logged in") when a clear end exists.
3. Use "rect" for every step, screen, action or service.
4. Use "diamond" for every yes/no or branching check. A diamond has 2 or more outgoing edges, each labelled ("yes"/"no", "valid"/"invalid", etc.).
5. Labels are 1-4 words, Title or sentence case, no punctuation at the end. Never put field lists or paragraphs in a label.
6. Every node must be connected: each node except the start has at least one incoming edge, and each node except an end has at least one outgoing edge. Retry/error loops go back to the earlier step.
7. Between 3 and 14 nodes. Ids are "n1", "n2", ... in the order steps happen.
8. color: every node is filled. "blue" for the start and for ordinary steps, "yellow" for decisions, "green" for success ends, "red" for error steps, "purple" only for external systems. Never use "none".
9. direction: "down" for processes and user flows, "right" for pipelines, timelines and data flows.
10. Edge "label" is "" unless the edge leaves a diamond.

Return only the JSON object.`;
}

export const WORKFLOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['direction', 'nodes', 'edges'],
  properties: {
    direction: { type: 'string', enum: ['down', 'right'] },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'shape', 'color'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          shape: { type: 'string', enum: ['rect', 'diamond', 'ellipse'] },
          color: { type: 'string', enum: ['blue', 'yellow', 'green', 'red', 'purple'] },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'label'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
  },
};

// Repairs a model reply so it is always a connected workflow:
// drops bad/duplicate edges and links any stranded node into the flow.
export function normalizeWorkflow(raw) {
  const direction = raw?.direction === 'right' ? 'right' : 'down';
  const nodes = [];
  const ids = new Set();
  for (const n of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    const id = String(n?.id ?? '').trim();
    const label = String(n?.label ?? n?.text ?? '').trim();
    if (!id || !label || ids.has(id)) continue;
    ids.add(id);
    nodes.push({ id, label: label.replace(/[.:;]+$/, ''), shape: n.shape, color: n.color });
    if (nodes.length === 16) break;
  }
  if (!nodes.length) throw new Error('The model did not return any workflow steps. Try rephrasing the prompt.');

  const seen = new Set();
  const edges = [];
  for (const e of Array.isArray(raw?.edges) ? raw.edges : []) {
    const from = String(e?.from ?? ''), to = String(e?.to ?? '');
    const key = `${from}>${to}`;
    if (!ids.has(from) || !ids.has(to) || from === to || seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to, label: String(e.label || '').slice(0, 20) });
  }

  // Link stranded nodes in reading order so nothing floats on its own.
  const touched = (id) => edges.some((e) => e.from === id || e.to === id);
  for (let i = 0; i < nodes.length; i++) {
    if (nodes.length > 1 && !touched(nodes[i].id)) {
      if (i > 0) edges.push({ from: nodes[i - 1].id, to: nodes[i].id, label: '' });
      else edges.push({ from: nodes[0].id, to: nodes[1].id, label: '' });
    }
  }
  return { direction, nodes, edges };
}
