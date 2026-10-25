/**
 * config.mjs — where everything lives, and the one place that reads it.
 *
 * The token, the Supabase session, the voice drafts and the composed series
 * all live OUTSIDE the repo, in ~/.config/lazypo-mcp (0700). Nothing here is
 * ever printed: `setup.mjs` writes the token, `token.mjs` prints it on demand.
 *
 * Supabase URL + publishable key are read from ../auth.js so the MCP server
 * can never drift from the front-end.
 */
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, renameSync } from 'node:fs';

export const MCP_ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(MCP_ROOT, '..');
export const QUIZ_HTML = join(REPO_ROOT, 'quiz.html');
export const PI_JS     = join(REPO_ROOT, 'pi.js');
export const AUTH_JS   = join(REPO_ROOT, 'auth.js');

export const CONFIG_DIR   = process.env.LAZYPO_MCP_DIR || join(homedir(), '.config', 'lazypo-mcp');
export const CONFIG_PATH  = join(CONFIG_DIR, 'config.json');
export const SESSION_PATH = join(CONFIG_DIR, 'session.json');
export const DRAFTS_PATH  = join(CONFIG_DIR, 'drafts.json');
export const SERIES_PATH  = join(CONFIG_DIR, 'series.json');

/** Anthropic's published outbound ranges (MCP tool calls, web fetch).
 *  https://platform.claude.com/docs/en/api/ip-addresses — IPv4 only today. */
export const ANTHROPIC_RANGES = ['160.79.104.0/21'];

export const DEFAULTS = Object.freeze({
  port: 8787,
  /** 'anthropic' = only Anthropic's ranges (plus the loopback for local tests); 'any' = token only */
  provenance: 'anthropic',
  /** Extra Host values accepted on /mcp, e.g. a Tailscale Funnel name. Loopback is always accepted. */
  publicHosts: [],
  /** 'draft' = dictated words wait on the local page; 'direct' = straight into `vocabulary` */
  vocabularyWrites: 'draft',
  rateLimitPerMinute: 60,
  /** How long a composed series stays gradable, in hours */
  seriesTtlHours: 12,
  email: '',
  /** Where depot.html lives — the links handed to the phone */
  appUrl: 'https://ndashiz.be/lazypo2/',
});

export function ensureDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try { chmodSync(CONFIG_DIR, 0o700); } catch { /* not ours to chmod (tests on tmp) */ }
}

export function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

/** Atomic private write: tmp file at 0600, then rename over the target. */
export function writeJsonPrivate(path, obj) {
  ensureDir();
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch { /* ignore */ }
  renameSync(tmp, path);
}

export class ConfigError extends Error {}

export function loadConfig() {
  const raw = readJson(CONFIG_PATH);
  if (!raw) throw new ConfigError(`Pas de configuration dans ${CONFIG_PATH} — lance d'abord : node mcp/setup.mjs`);
  const cfg = { ...DEFAULTS, ...raw };
  if (typeof cfg.token !== 'string' || cfg.token.length < 32) {
    throw new ConfigError(`Jeton absent ou trop court dans ${CONFIG_PATH} — relance : node mcp/setup.mjs --rotate`);
  }
  cfg.port = Number(cfg.port) || DEFAULTS.port;
  cfg.publicHosts = (Array.isArray(cfg.publicHosts) ? cfg.publicHosts : []).map(h => String(h).toLowerCase());
  if (!['anthropic', 'any'].includes(cfg.provenance)) cfg.provenance = DEFAULTS.provenance;
  if (!['draft', 'direct'].includes(cfg.vocabularyWrites)) cfg.vocabularyWrites = DEFAULTS.vocabularyWrites;
  cfg.appUrl = String(cfg.appUrl || DEFAULTS.appUrl).replace(/\/?$/, '/');
  return cfg;
}

/** Supabase coordinates, read from the front-end so there is exactly one copy. */
export function supabaseCoordinates() {
  const src = readFileSync(AUTH_JS, 'utf8');
  const url = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(src);
  const key = /SUPABASE_ANON\s*=\s*'([^']+)'/.exec(src);
  if (!url || !key) throw new ConfigError('auth.js : SUPABASE_URL / SUPABASE_ANON introuvables');
  return { url: url[1], key: key[1] };
}
