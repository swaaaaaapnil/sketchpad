// The fixed prompt template every AI request goes through. The user's text is
// only ever inserted inside <request> tags; the rules around it stay the same,
// so the reply is always a workflow graph the app can lay out.

export const SYSTEM_PROMPT = `You are the diagram planner inside a hand-drawn whiteboard app.
You turn any request into a graph: nodes joined by arrows (edges). Depending on the request, the graph is either a
step-by-step WORKFLOW or a SYSTEM DESIGN (software architecture: components and how data moves between them).
You never draw, position, size or nest anything. The app does all layout.
You always answer by returning one JSON object that matches the schema, and nothing else.`;

// Words that signal a software-architecture request rather than a process/user flow.
const SYSTEM_DESIGN_RE = new RegExp(
  [
    'system design', 'architecture', 'architect', 'design (a|an|the)? ?[a-z ]*(like|clone|system|service|platform|app)',
    'micro-?services?', 'backend', 'back-end', 'infra(structure)?', 'scal(e|able|ability|ing)', 'high[- ]availability',
    'load ?balancer', 'api gateway', 'gateway', 'reverse proxy', 'cdn', 'cache', 'caching', 'redis', 'memcached',
    'database', '\\bdb\\b', 'postgres', 'mysql', 'mongo', 'dynamo', 'cassandra', 'sharding', 'replica',
    'queue', 'kafka', 'rabbitmq', 'pub/?sub', 'event[- ]driven', 'message broker', 'stream processing',
    'kubernetes', 'k8s', 'docker', 'serverless', 'lambda', 's3', 'blob storage', 'object storage',
    'websocket', 'grpc', 'rest api', 'rate limit', 'url shortener', 'distributed', 'data pipeline', 'etl',
  ].join('|'),
  'i',
);

// "Design Twitter", "How would you build Uber" — product-design asks with no UI/flow words.
const DESIGN_PRODUCT_RE = /^\s*(how (would|do|to) (you )?)?(design|build|architect)\b/i;
const FLOW_WORDS_RE = /\b(flow|journey|steps?|process|page|screen|form|ui|ux|wireframe|logo|onboarding|checkout flow|signup flow|login flow)\b/i;

export function detectKind(request) {
  const text = String(request || '');
  if (FLOW_WORDS_RE.test(text) && !/system design|architecture/i.test(text)) return 'flow';
  if (SYSTEM_DESIGN_RE.test(text) || DESIGN_PRODUCT_RE.test(text)) return 'system';
  return 'flow';
}

const FLOW_RULES = `Turn the request below into a workflow diagram.

<request>
{{REQUEST}}
</request>

How to build the workflow:
1. Read the request as a process. If it describes screens or UI parts, model the journey through them, not their visual layout. Example: "login page with username, password and submit" becomes User visits → Login page → Enter credentials → Valid? → Dashboard.
2. Begin with one "ellipse" node for the start (e.g. "Start", "User visits") and end each finished path with an "ellipse" node (e.g. "Done", "Logged in") when a clear end exists.
3. Use "rect" for every step, screen or action.
4. Use "diamond" for every yes/no or branching check. A diamond has 2 or more outgoing edges, each labelled ("yes"/"no", "valid"/"invalid", etc.).
5. Labels are 1-4 words, sentence case, no punctuation at the end. Never put field lists or paragraphs in a label.
6. Every node must be connected: each node except the start has an incoming edge, and each node except an end has an outgoing edge. Retry/error loops go back to the earlier step.
7. Between 3 and 14 nodes. Ids are "n1", "n2", ... in the order steps happen.
8. color: every node is filled. "blue" for the start and for ordinary steps, "yellow" for decisions, "green" for success ends, "red" for error steps, "purple" only for external systems.
9. direction: "down".
10. Edge "label" is "" unless the edge leaves a diamond.

Return only the JSON object.`;

const SYSTEM_RULES = `Turn the request below into a SYSTEM DESIGN diagram: the components of the system and how requests and data flow between them.

<request>
{{REQUEST}}
</request>

How to build the architecture:
1. Nodes are components, not steps. Pick what a senior engineer would draw on a whiteboard for this system, e.g. clients, CDN, load balancer, API gateway, the individual services, cache, databases, object storage, message queue, background workers, third-party APIs.
2. Order the nodes left to right by layer: clients → edge/entry (CDN, load balancer, gateway) → services → async layer (queues, workers) → data stores. Ids "n1", "n2", ... follow that order.
3. shape and color by component type (every node is filled):
   - Users, browsers, mobile apps: "ellipse", "blue".
   - CDN, DNS, load balancer, API gateway, auth/edge: "rect", "yellow".
   - Application services and APIs (name each by its job, e.g. "Feed service", "Upload service"): "rect", "blue".
   - Queues, streams, schedulers, background workers: "rect", "purple".
   - Databases, caches, search indexes, object/blob storage (name the role and, if obvious, the tech, e.g. "Posts DB (Postgres)", "Redis cache"): "ellipse", "green".
   - External / third-party systems (payments, email, maps, LLM APIs): "rect", "red".
   - Use "diamond" only for a real routing decision (e.g. "Cache hit?"); most architectures have none.
4. Edges follow the direction requests and data travel (caller → callee, producer → queue → consumer, service → store). Label every edge with the interaction in 1-3 words, e.g. "HTTPS", "REST", "gRPC", "reads", "writes", "publishes", "consumes", "cache miss", "uploads".
5. Split a big monolith into the 2-5 services the request implies. Give each service its own data store when that is the usual design. Add a cache in front of hot reads and a queue for slow or async work only when the request needs scale or async processing.
6. Labels are 1-4 words, no punctuation at the end. No descriptions inside labels.
7. Every node is connected. Between 4 and 16 nodes.
8. direction: "right".

Return only the JSON object.`;

export function buildUserPrompt(request, kind = detectKind(request)) {
  const clean = String(request || '').replace(/<\/?request>/gi, '').trim().slice(0, 2000);
  return (kind === 'system' ? SYSTEM_RULES : FLOW_RULES).replace('{{REQUEST}}', clean);
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
    edges.push({ from, to, label: String(e.label || '').slice(0, 24) });
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
