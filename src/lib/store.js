// Board storage. Uses Supabase when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
// are set (see .env.example), otherwise falls back to localStorage.
// Every function is async so the UI does not care which backend is active.
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const LOCAL_KEY = 'sketchpad.boards.v1';
const LEGACY_KEY = 'sketchpad.doc.v1';

export const supabase = URL && KEY ? createClient(URL, KEY, { auth: { flowType: 'pkce' } }) : null;
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

const COLS = 'id,owner,title,shapes,dark,created_at,updated_at';

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

/* ---------- accounts (Supabase only) ---------- */

export const canSignIn = !!supabase;
const RETURN_KEY = 'sketchpad.returnTo';

/** After a Google redirect, the hash route the user started from (read once). */
export function takeReturnHash() {
  try {
    const h = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return h && h.startsWith('#/') ? h : null;
  } catch {
    return null;
  }
}

function toAccount(user) {
  if (!user) return null;
  const m = user.user_metadata || {};
  const isGuest = !!user.is_anonymous;
  return {
    id: user.id,
    isGuest,
    email: user.email || '',
    name: isGuest ? 'Guest' : m.full_name || m.name || (user.email || 'You').split('@')[0],
    avatar: !isGuest && /^https:\/\//.test(m.avatar_url || m.picture || '') ? m.avatar_url || m.picture : '',
  };
}

/** Current account ({id, isGuest, name, email, avatar}) or null in local mode. */
export async function getAccount() {
  if (!supabase) return null;
  const session = await ensureSession();
  return toAccount(session?.user);
}

/** Calls fn(account) whenever the user signs in or out. Returns an unsubscribe fn. */
export function onAccountChange(fn) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session) fn(toAccount(session.user));
  });
  return () => data.subscription.unsubscribe();
}

/**
 * Google sign-in. A guest is upgraded in place (same user id, so their boards stay
 * theirs). If that Google account already exists, we sign in to it instead.
 */
export async function signInWithGoogle() {
  needCloud();
  const session = await ensureSession();
  // Google returns to the bare app URL; App.jsx restores this hash afterwards.
  const redirectTo = window.location.origin + window.location.pathname;
  try {
    sessionStorage.setItem(RETURN_KEY, window.location.hash);
  } catch {
    /* optional: user lands on Home instead */
  }
  if (session?.user?.is_anonymous) {
    const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo } });
    if (!error) return;
    if (!/already|exists|linked/i.test(error.message)) throw new Error(error.message);
  }
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw new Error(error.message);
}

/** Signs out, forgets this user's saved AI keys, and starts a fresh guest session. */
export async function signOut() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && uid && k.startsWith(`sketchpad.ai.key.${uid}.`)) localStorage.removeItem(k);
    }
  } catch {
    /* storage blocked */
  }
  await supabase.auth.signOut();
  sessionReady = null;
  await ensureSession();
}

/* ---------- sharing (Supabase only) ---------- */

export const canShare = !!supabase;

function needCloud() {
  if (!supabase) throw new Error('Sharing needs the cloud backend. This copy keeps sketches in this browser only.');
}

async function rpc(name, args) {
  needCloud();
  await ensureSession();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

/** {view: token|null, edit: token|null, people: n} — owner only. */
export const getShare = (id) => rpc('get_share', { b: id });
export const enableShare = (id, role) => rpc('enable_share', { b: id, r: role });
export const disableShare = (id, role) => rpc('disable_share', { b: id, r: role });
/** Returns 'owner' | 'edit' | 'view', 'signin' (guest opened an edit link) or null. */
export const joinBoard = (id, token) => rpc('join_board', { b: id, token });
/** 'owner' | 'edit' | 'view' | null, or 'owner' in local mode. */
export const myRole = (id) => (supabase ? rpc('board_role', { b: id }) : Promise.resolve('owner'));

export function shareUrl(id, token) {
  return `${window.location.origin}${window.location.pathname}#/b/${id}?k=${encodeURIComponent(token)}`;
}

/** Calls onChange(row) whenever someone else saves this board. Returns an unsubscribe fn. */
export function watchBoard(id, onChange) {
  if (!supabase) return () => {};
  let channel = null;
  let stopped = false;
  ensureSession().then(() => {
    if (stopped) return;
    channel = supabase
      .channel(`board:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'boards', filter: `id=eq.${id}` }, (msg) => onChange(msg.new || {}))
      .subscribe();
  });
  return () => {
    stopped = true;
    if (channel) supabase.removeChannel(channel);
  };
}

/**
 * Who is on this board right now. me = {id, name, avatar, role}.
 * Calls onPeople([{id, name, avatar, role}]) with everyone (one entry per user).
 */
export function joinPresence(id, me, onPeople) {
  if (!supabase || !me) return () => {};
  let channel = null;
  let stopped = false;
  ensureSession().then(async () => {
    if (stopped) return;
    const { data } = await supabase.auth.getSession();
    if (data.session) supabase.realtime.setAuth(data.session.access_token);
    channel = supabase.channel(`presence:${id}`, { config: { private: true, presence: { key: me.id } } });
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        onPeople(Object.values(state).map((metas) => metas[0]).filter(Boolean));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track({ id: me.id, name: me.name, avatar: me.avatar, role: me.role });
      });
  });
  return () => {
    stopped = true;
    if (channel) supabase.removeChannel(channel);
  };
}
