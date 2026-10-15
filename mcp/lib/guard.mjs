/**
 * guard.mjs — the five controls, in the order they earn their keep:
 *   provenance → token (constant time) → Host → rate limit.
 * (The fifth, "the token is written nowhere else", is a property of the
 * rest of the code, not a function here.)
 *
 * Every refusal is a bare 404 — a scanner learns nothing, not even that
 * there is something to authenticate against.
 */
import { timingSafeEqual } from 'node:crypto';

/* ── IPv4 helpers ─────────────────────────────────────────────── */
function ipv4ToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255) return null;
    n = (n * 256) + o;
  }
  return n;
}

/** '::ffff:1.2.3.4' → '1.2.3.4', brackets and zone ids dropped. */
export function normaliseIp(ip) {
  if (!ip) return '';
  let s = String(ip).trim().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (mapped) s = mapped[1];
  return s;
}

export function parseCidr(cidr) {
  const [base, bitsStr] = String(cidr).split('/');
  const b = ipv4ToInt(base);
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (b === null || !(bits >= 0 && bits <= 32)) throw new Error(`CIDR invalide : ${cidr}`);
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return { base: (b & mask) >>> 0, mask };
}

export function ipInRanges(ip, ranges) {
  const n = ipv4ToInt(normaliseIp(ip));
  if (n === null) return false;   // IPv6: Anthropic publishes no outbound v6 range
  return ranges.map(parseCidr).some(r => ((n & r.mask) >>> 0) === r.base);
}

export function isLoopback(ip) {
  const s = normaliseIp(ip);
  return s === '::1' || /^127\.\d+\.\d+\.\d+$/.test(s);
}

/* ── Who is calling ───────────────────────────────────────────── */
/** Client address as the tunnel reports it, and whether a tunnel was involved. */
export function clientInfo(req) {
  const h = req.headers || {};
  const cf  = h['cf-connecting-ip'];
  const xff = h['x-forwarded-for'];
  const socket = normaliseIp(req.socket && req.socket.remoteAddress);
  if (cf)  return { ip: normaliseIp(Array.isArray(cf) ? cf[0] : cf), viaProxy: true, socket };
  if (xff) return { ip: normaliseIp(String(Array.isArray(xff) ? xff[0] : xff).split(',')[0]), viaProxy: true, socket };
  return { ip: socket, viaProxy: false, socket };
}

/* ── Token ────────────────────────────────────────────────────── */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The token may sit in ANY header, raw or as `Bearer <token>`: the connector
 *  UI picks the header name from a list, and the one picked is not always the
 *  one planned. */
export function tokenPresented(req, token) {
  if (!token) return false;
  const headers = req.headers || {};
  for (const name of Object.keys(headers)) {
    if (name === 'host' || name === 'cookie') continue;
    const raw = headers[name];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (typeof v !== 'string' || v.length > 4096) continue;
      const candidate = v.replace(/^\s*Bearer\s+/i, '').trim();
      if (candidate && safeEqual(candidate, token)) return true;
    }
  }
  return false;
}

/* ── Host ─────────────────────────────────────────────────────── */
export function loopbackHosts(port) {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

export function hostAllowed(req, allowed) {
  const host = String((req.headers && req.headers.host) || '').toLowerCase().trim();
  return !!host && allowed.includes(host);
}

/* ── Rate limit (fixed one-minute window per address) ─────────── */
export class RateLimiter {
  constructor(perMinute = 60, now = Date.now) {
    this.perMinute = perMinute;
    this.now = now;
    this.buckets = new Map();
  }
  allow(key) {
    const t = this.now();
    const minute = Math.floor(t / 60000);
    let b = this.buckets.get(key);
    if (!b || b.minute !== minute) { b = { minute, count: 0 }; this.buckets.set(key, b); }
    b.count += 1;
    if (this.buckets.size > 10000) this.buckets.clear();   // a scanner must not grow memory
    return b.count <= this.perMinute;
  }
}

/* ── The gate for /mcp ────────────────────────────────────────── */
/**
 * @returns {{ok: true, ip: string} | {ok: false, reason: string}}
 */
export function guardMcp(req, cfg, limiter, ranges) {
  const { ip, viaProxy } = clientInfo(req);

  // a. provenance — Anthropic's ranges through a tunnel, or a plain local call
  if (cfg.provenance === 'anthropic') {
    const local = !viaProxy && isLoopback(ip);
    if (!local && !ipInRanges(ip, ranges)) return { ok: false, reason: 'provenance' };
  }
  // b. token — constant time, any header
  if (!tokenPresented(req, cfg.token)) return { ok: false, reason: 'token' };
  // c. Host — loopback forms, plus whatever the tunnel is configured to present
  if (!hostAllowed(req, loopbackHosts(cfg.port).concat(cfg.publicHosts))) return { ok: false, reason: 'host' };
  // d. ceiling — a voice conversation never needs more
  if (!limiter.allow(ip || 'unknown')) return { ok: false, reason: 'rate' };
  return { ok: true, ip };
}

/** The local face (page + /api) answers only to a browser on this machine. */
export function isLocalFace(req, port) {
  const { viaProxy, socket } = clientInfo(req);
  if (viaProxy || !isLoopback(socket)) return false;
  return hostAllowed(req, loopbackHosts(port));
}

/** A state-changing call on the local face must come from our own page:
 *  JSON body (no cross-origin form can send one without a preflight) and,
 *  when the browser says where it came from, from this origin. */
export function localWriteAllowed(req, port) {
  const h = req.headers || {};
  const ct = String(h['content-type'] || '').toLowerCase();
  if (!ct.startsWith('application/json')) return false;
  const site = h['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = h['origin'];
  if (origin) {
    const ok = loopbackHosts(port).map(x => `http://${x}`);
    if (!ok.includes(String(origin).toLowerCase())) return false;
  }
  return true;
}
