/**
 * supa.mjs — one Supabase client, logged in as Simon, RLS doing the real work.
 *
 * No service key anywhere. `login.mjs` signs in once with the password (typed
 * in the terminal, never stored) and the session — access + refresh token —
 * lives in ~/.config/lazypo-mcp/session.json (0600). supabase-js refreshes it
 * on demand through the same file-backed storage, so the server keeps working
 * for as long as the refresh token stays valid.
 */
import { createClient } from '@supabase/supabase-js';
import { unlinkSync, readFileSync, existsSync } from 'node:fs';
import { SESSION_PATH, supabaseCoordinates, writeJsonPrivate } from './config.mjs';

export class NotLoggedIn extends Error {
  constructor(msg = 'Pas de session Supabase sur le Mac — lance `node mcp/login.mjs` dans le dossier LazyPO, puis réessaie.') {
    super(msg);
    this.name = 'NotLoggedIn';
  }
}

const fileStorage = {
  getItem() {
    try { return existsSync(SESSION_PATH) ? readFileSync(SESSION_PATH, 'utf8') : null; } catch { return null; }
  },
  setItem(_k, value) {
    try { writeJsonPrivate(SESSION_PATH, JSON.parse(value)); } catch { /* malformed: ignore */ }
  },
  removeItem() {
    try { unlinkSync(SESSION_PATH); } catch { /* already gone */ }
  },
};

export function makeClient() {
  const { url, key } = supabaseCoordinates();
  return createClient(url, key, {
    auth: {
      storage: fileStorage,
      storageKey: 'lazypo-mcp',
      persistSession: true,
      autoRefreshToken: false,      // refreshed on demand by getSession()
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
    global: { headers: { 'x-lazypo-channel': 'voice-mcp' } },
  });
}

/** The signed-in user, refreshing the token if needed. Throws NotLoggedIn. */
export async function requireUser(sb) {
  const { data, error } = await sb.auth.getSession();
  const session = data && data.session;
  if (error || !session || !session.user) {
    throw new NotLoggedIn(error
      ? `Session Supabase expirée ou invalide (${error.message}) — relance \`node mcp/login.mjs\` sur le Mac.`
      : undefined);
  }
  return session.user;
}

/** Everything, 1000 rows at a time — the Supabase default cap. */
async function pageAll(build) {
  const PAGE = 1000;
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export const ANSWER_COLS = 'word_id, mode, answered_at, direction, stage, grade, correct, close_match, first_key_ms, is_new, is_relearn, is_leech, was_due, interval_before, interval_after';

/** All the reading a tool can need, in one parallel burst. `missing` lists
 *  the optional tables the base does not have (quiz_srs_v2.sql not run). */
export async function loadLearning(sb, uid, { days = 28 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const missing = [];
  const [words, progressRows, log, settings, xp, sessions] = await Promise.all([
    pageAll(() => sb.from('vocabulary').select('*').eq('user_id', uid).order('created_at', { ascending: false })),
    pageAll(() => sb.from('quiz_progress').select('*').eq('user_id', uid)),
    pageAll(() => sb.from('quiz_answers').select(ANSWER_COLS).eq('user_id', uid).gte('answered_at', since).order('answered_at', { ascending: true }))
      .catch(() => { missing.push('quiz_answers'); return []; }),
    sb.from('quiz_settings').select('new_per_day, adjusted_on, last_reason').eq('user_id', uid).maybeSingle()
      .then(r => { if (r.error) { missing.push('quiz_settings'); return null; } return r.data; }),
    sb.from('user_xp').select('*').eq('user_id', uid).maybeSingle().then(r => r.error ? null : r.data),
    sb.from('quiz_sessions').select('created_at, score, total, mode, lang, duration_sec').eq('user_id', uid)
      .order('created_at', { ascending: false }).limit(3).then(r => r.error ? [] : (r.data || [])),
  ]);
  const progress = {};
  for (const p of progressRows) progress[p.word_id] = p;
  return {
    words, progress, log,
    settings: settings || { new_per_day: 8, adjusted_on: null, last_reason: null },
    xp, sessions, missing,
  };
}

export async function loadProfile(sb, uid) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).single();
  if (error) return { username: null, pi: null, countdowns: [], todo_tasks: [] };
  return data;
}
