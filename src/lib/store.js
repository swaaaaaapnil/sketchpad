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
// Always reads the live session (it changes on sign-in); only the guest sign-up is shared.
async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  if (!sessionReady) {
    sessionReady = supabase.auth.signInAnonymously().then(({ data: signed, error }) => {
      if (error) throw new Error(`Supabase sign-in failed: ${error.message}`);
      return signed.session;
    }).finally(() => { sessionReady = null; });
  }
  return sessionReady;
}

const COLS = 'id,owner,title,shapes,dark,version,created_at,updated_at';

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
  async remove(id) {
    await ensureSession();
    check(await supabase.from('boards').delete().eq('id', id));
  },
};

const api = supabase ? remote : local;

export const listBoards = () => api.list();
export const getBoard = (id) => api.get(id);
export const createBoard = (fields = {}) => api.create(fields);
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
  await claimGuestBoards(session);
  return toAccount(session?.user);
}

// Signing in to a Google account that already exists changes the user id, which
// would strand the sketches drawn as a guest. Before signing in, the guest gets a
// one-time ticket; once signed in, the account redeems it and the boards move over.
const TRANSFER_KEY = 'sketchpad.guestTransfer';

async function prepareGuestTransfer() {
  const { data, error } = await supabase.rpc('start_guest_transfer');
  if (error || !data) return;
  try { localStorage.setItem(TRANSFER_KEY, data); } catch { /* storage blocked */ }
}

let claiming = null;
async function claimGuestBoards(session) {
  if (!session || session.user?.is_anonymous) return 0;
  let t = null;
  try { t = localStorage.getItem(TRANSFER_KEY); } catch { /* storage blocked */ }
  if (!t) return 0;
  if (!claiming) {
    claiming = supabase.rpc('finish_guest_transfer', { t })
      .then(({ data }) => { try { localStorage.removeItem(TRANSFER_KEY); } catch { /* */ } return data || 0; })
      .finally(() => { claiming = null; });
  }
  return claiming;
}

/** Calls fn(account) whenever the user signs in or out. Returns an unsubscribe fn. */
export function onAccountChange(fn) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) return;
    // Run outside the auth callback (supabase-js deadlocks on awaited calls inside it).
    setTimeout(() => claimGuestBoards(session).catch(() => 0).finally(() => fn(toAccount(session.user))), 0);
  });
  return () => data.subscription.unsubscribe();
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Google's own prompt, so the account chooser names this site instead of the
// Supabase project. Resolves with { token, nonce }, or null if Google could not
// show the prompt (blocked, dismissed, cooldown) so the caller can fall back.
async function googleIdToken() {
  if (!GOOGLE_CLIENT_ID) return null;
  await loadGis();
  const nonce = crypto.randomUUID();
  const hashed = await sha256Hex(nonce);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      nonce: hashed,
      use_fedcm_for_prompt: true,
      cancel_on_tap_outside: false,
      callback: (r) => finish(r?.credential ? { token: r.credential, nonce } : null),
    });
    window.google.accounts.id.prompt((n) => {
      if (n.isNotDisplayed?.() || n.isSkippedMoment?.()) finish(null);
    });
  });
}

async function redirectSignIn(isGuest) {
  // Google returns to the bare app URL; App.jsx restores this hash afterwards.
  const redirectTo = window.location.origin + window.location.pathname;
  try {
    sessionStorage.setItem(RETURN_KEY, window.location.hash);
  } catch {
    /* optional: user lands on Home instead */
  }
  if (isGuest) await prepareGuestTransfer();
  if (isGuest) {
    const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo } });
    if (!error) return;
    if (!/already|exists|linked/i.test(error.message)) throw new Error(error.message);
  }
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw new Error(error.message);
}

/**
 * Google sign-in. A guest is upgraded in place (same user id, so their boards stay
 * theirs). If that Google account already exists, we sign in to it instead.
 * Uses Google's in-page prompt when VITE_GOOGLE_CLIENT_ID is set, else a redirect.
 */
export async function signInWithGoogle() {
  needCloud();
  const session = await ensureSession();
  const isGuest = !!session?.user?.is_anonymous;
  const id = await googleIdToken().catch(() => null);
  if (!id) return redirectSignIn(isGuest);
  return finishIdToken(id, isGuest);
}

async function finishIdToken(id, isGuest) {
  const creds = { provider: 'google', token: id.token, nonce: id.nonce };
  if (isGuest) await prepareGuestTransfer();
  if (isGuest) {
    const { error } = await supabase.auth.linkIdentity(creds);
    if (!error) {
      // The old token still says "anonymous"; get a fresh one so the app and RLS see the account.
      const { error: e2 } = await supabase.auth.refreshSession();
      if (e2) throw new Error(e2.message);
      return;
    }
    if (!/already|exists|linked/i.test(error.message)) throw new Error(error.message);
  }
  const { data, error } = await supabase.auth.signInWithIdToken(creds);
  if (error) throw new Error(error.message);
  await claimGuestBoards(data.session);
}

/**
 * Renders Google's own "Sign in with Google" button into `el`. Clicking it opens
 * Google's popup (named after this site), then signs in / upgrades the guest.
 * Returns false when Google's button can't be used, so the caller can show a fallback.
 */
export async function renderGoogleButton(el, { before, onDone, onError, theme = 'outline', text = 'signin_with' } = {}) {
  if (!GOOGLE_CLIENT_ID || !el) return false;
  needCloud();
  try {
    await loadGis();
  } catch {
    return false;
  }
  const nonce = crypto.randomUUID();
  const hashed = await sha256Hex(nonce);
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    nonce: hashed,
    callback: async (r) => {
      try {
        if (!r?.credential) throw new Error('Google sign-in was cancelled');
        await before?.();
        const session = await ensureSession();
        await finishIdToken({ token: r.credential, nonce }, !!session?.user?.is_anonymous);
        onDone?.();
      } catch (e) {
        onError?.(e);
      }
    },
  });
  el.innerHTML = '';
  window.google.accounts.id.renderButton(el, { theme, size: 'large', text, shape: 'pill', logo_alignment: 'left', width: Math.min(Math.max(el.clientWidth || 240, 200), 400) });
  return true;
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

/**
 * Saves a batch of shape changes. In the cloud the server merges them per shape
 * (save_board_ops), so editors never overwrite each other. Returns {version, updated_at}.
 * A save that is too fast throws an Error with .rateLimited = true.
 * snapshot() gives the whole board, used only by the browser-only backend.
 */
export async function saveChanges(id, wire, snapshot) {
  if (!supabase) {
    const row = await local.save(id, snapshot());
    return { version: 0, updated_at: row.updated_at };
  }
  await ensureSession();
  const { data, error } = await supabase.rpc('save_board_ops', {
    b: id,
    up: wire.up,
    del: wire.del,
    ord: wire.ord,
    new_title: wire.title ?? null,
    new_dark: wire.dark ?? null,
  });
  if (error) {
    const err = new Error(error.code === 'PT429' ? 'Saving too fast' : error.message);
    err.rateLimited = error.code === 'PT429';
    throw err;
  }
  return data;
}

/** Latest saved version number of a board (a tiny read used to spot missed edits). */
export async function boardVersion(id) {
  if (!supabase) return 0;
  await ensureSession();
  const { data } = await supabase.from('boards').select('version').eq('id', id).maybeSingle();
  return data?.version ?? 0;
}

async function privateChannel(topic, config = {}) {
  await ensureSession();
  const { data } = await supabase.auth.getSession();
  if (data.session) supabase.realtime.setAuth(data.session.access_token);
  return supabase.channel(topic, { config: { private: true, ...config } });
}

/**
 * Live edits for a board over a private broadcast channel.
 * handlers: onOps(ops, from), onSaved(version, from), onStatus('live' | 'connecting' | 'offline', firstTime)
 * Returns { send(event, payload), stop() }. Viewers can listen but not send.
 */
export function joinLive(id, me, { onOps, onSaved, onStatus }) {
  if (!supabase) return { send() {}, stop() {} };
  let channel = null;
  let stopped = false;
  let joinedOnce = false;
  onStatus?.('connecting', true);
  privateChannel(`live:${id}`, { broadcast: { self: false, ack: false } }).then((ch) => {
    if (stopped) return supabase.removeChannel(ch);
    channel = ch;
    ch.on('broadcast', { event: 'ops' }, ({ payload }) => payload?.from !== me && onOps?.(payload.ops || {}, payload.from))
      .on('broadcast', { event: 'saved' }, ({ payload }) => payload?.from !== me && onSaved?.(payload.version, payload.from))
      .subscribe((status) => {
        if (stopped) return;
        if (status === 'SUBSCRIBED') {
          onStatus?.('live', !joinedOnce);
          joinedOnce = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('offline', false);
        else if (status === 'CLOSED') onStatus?.('connecting', false);
      });
  }).catch(() => onStatus?.('offline', false));
  return {
    send(event, payload) {
      if (!channel || channel.state !== 'joined') return false;
      channel.send({ type: 'broadcast', event, payload: { ...payload, from: me } });
      return true;
    },
    stop() {
      stopped = true;
      if (channel) supabase.removeChannel(channel);
    },
  };
}

/**
 * Who is on this board right now, and where their pointer is.
 * me = {id, name, avatar, role}. onPeople([{id, name, avatar, role}]) gets one entry per user;
 * onCursor({id, x, y} | {id, gone: true}) gets other people's pointers in board coordinates.
 * Returns { cursor(x, y) | cursor(null), stop() }.
 */
export function joinPresence(id, me, onPeople, onCursor) {
  if (!supabase || !me) return { cursor() {}, stop() {} };
  let channel = null;
  let stopped = false;
  privateChannel(`presence:${id}`, { presence: { key: me.id }, broadcast: { self: false } }).then((ch) => {
    if (stopped) return supabase.removeChannel(ch);
    channel = ch;
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState();
      onPeople(Object.values(state).map((metas) => metas[0]).filter(Boolean));
    })
      .on('presence', { event: 'leave' }, ({ key }) => onCursor?.({ id: key, gone: true }))
      .on('broadcast', { event: 'cursor' }, ({ payload }) => payload?.id !== me.id && onCursor?.(payload))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') ch.track({ id: me.id, name: me.name, avatar: me.avatar, role: me.role });
      });
  });
  return {
    cursor(x, y) {
      if (!channel || channel.state !== 'joined') return;
      channel.send({ type: 'broadcast', event: 'cursor', payload: x == null ? { id: me.id, gone: true } : { id: me.id, x: Math.round(x), y: Math.round(y) } });
    },
    stop() {
      stopped = true;
      if (channel) supabase.removeChannel(channel);
    },
  };
}
