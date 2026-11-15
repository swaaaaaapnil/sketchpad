// Board storage. Uses Supabase when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
// are set (see .env.example), otherwise falls back to localStorage.
// Every function is async so the UI does not care which backend is active.
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const LOCAL_KEY = 'sketchpad.boards.v1';
const LEGACY_KEY = 'sketchpad.doc.v1';

export const supabase = URL && KEY ? createClient(URL, KEY) : null;
export const backendName = supabase ? 'supabase' : 'local';

const now = () => new Date().toISOString();
const uuid = () =>
  crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/* ---------- local backend ---------- */

function readLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_KEY));
    if (data && typeof data === 'object') return data;
  } catch {
    /* corrupt storage: start fresh */
  }
  // One-time migration from the single-document version.
  const boards = {};
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (legacy?.shapes?.length) {
      const id = uuid();
      boards[id] = { id, title: 'My first sketch', shapes: legacy.shapes, dark: !!legacy.dark, created_at: now(), updated_at: now() };
    }
  } catch {
    /* nothing to migrate */
  }
  return boards;
}

function writeLocal(boards) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(boards));
}

const local = {
  async list() {
    return Object.values(readLocal()).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  async get(id) {
    return readLocal()[id] ?? null;
  },
  async create(fields) {
    const boards = readLocal();
    const b = { id: uuid(), title: 'Untitled sketch', shapes: [], dark: false, created_at: now(), updated_at: now(), ...fields };
    boards[b.id] = b;
    writeLocal(boards);
    return b;
  },
  async save(id, patch) {
    const boards = readLocal();
    if (!boards[id]) throw new Error('Board not found');
    boards[id] = { ...boards[id], ...patch, updated_at: now() };
    writeLocal(boards);
    return boards[id];
  },
  async remove(id) {
    const boards = readLocal();
    delete boards[id];
    writeLocal(boards);
  },
};

/* ---------- supabase backend ---------- */

let sessionReady = null;
// Anonymous sign-in gives each browser its own user id, so RLS keeps boards private
// without a login screen. Enable "Anonymous sign-ins" in Supabase Auth settings.
function ensureSession() {
  if (!sessionReady) {
    sessionReady = (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) return data.session;
      const { data: signed, error } = await supabase.auth.signInAnonymously();
      if (error) throw new Error(`Supabase sign-in failed: ${error.message}`);
      return signed.session;
    })().catch((e) => {
      sessionReady = null;
      throw e;
    });
  }
  return sessionReady;
}

const COLS = 'id,title,shapes,dark,created_at,updated_at';

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

const remote = {
  async list() {
    await ensureSession();
    return check(await supabase.from('boards').select(COLS).order('updated_at', { ascending: false }));
  },
  async get(id) {
    await ensureSession();
    return check(await supabase.from('boards').select(COLS).eq('id', id).maybeSingle());
  },
  async create(fields) {
    await ensureSession();
    const row = { title: 'Untitled sketch', shapes: [], dark: false, ...fields };
    return check(await supabase.from('boards').insert(row).select(COLS).single());
  },
  async save(id, patch) {
    await ensureSession();
    return check(await supabase.from('boards').update(patch).eq('id', id).select(COLS).single());
  },
  async remove(id) {
    await ensureSession();
    check(await supabase.from('boards').delete().eq('id', id));
  },
};

const api = supabase ? remote : local;

export const listBoards = () => api.list();
export const getBoard = (id) => api.get(id);
export const createBoard = (fields = {}) => api.create(fields);
export const saveBoard = (id, patch) => api.save(id, patch);
export const deleteBoard = (id) => api.remove(id);
export async function duplicateBoard(id) {
  const src = await api.get(id);
  if (!src) throw new Error('Board not found');
  return api.create({ title: `${src.title} (copy)`, shapes: src.shapes, dark: src.dark });
}

/** Call the draw-ai edge function (server holds the model key). */
export async function generateViaSupabase(prompt) {
  if (!supabase) throw new Error('Supabase is not configured.');
  await ensureSession();
  const { data, error } = await supabase.functions.invoke('draw-ai', { body: { prompt } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data.text;
}
