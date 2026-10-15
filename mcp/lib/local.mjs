/**
 * local.mjs — the second face, for the eyes: a page on the loopback only.
 * Through the tunnel every route here is a bare 404 (server.mjs decides
 * with guard.isLocalFace before calling us).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_ROOT } from './config.mjs';
import { localWriteAllowed } from './guard.mjs';
import { listDrafts, getDraft, removeDraft } from './drafts.mjs';
import { countSeries } from './series.mjs';
import { requireUser } from './supa.mjs';
import { insertWord } from './quiz.mjs';

const PAGE = join(MCP_ROOT, 'public', 'index.html');
const started = Date.now();

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('body trop grand')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function handleLocal(req, res, url, ctx) {
  const { cfg, sb } = ctx;
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'",
      'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
    });
    res.end(readFileSync(PAGE, 'utf8'));
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    let session = null;
    try { const u = await requireUser(sb); session = { email: u.email, uid: u.id }; } catch { /* not logged in */ }
    return json(res, 200, {
      ok: true, session, drafts: listDrafts(), series: countSeries(),
      uptimeSec: Math.round((Date.now() - started) / 1000),
      config: { port: cfg.port, provenance: cfg.provenance, publicHosts: cfg.publicHosts, vocabularyWrites: cfg.vocabularyWrites, rateLimitPerMinute: cfg.rateLimitPerMinute },
    }), true;
  }
  const m = /^\/api\/drafts\/([A-Za-z0-9-]{1,16})\/(accept|reject)$/.exec(url.pathname);
  if (m && req.method === 'POST') {
    if (!localWriteAllowed(req, cfg.port)) { res.writeHead(404).end(); return true; }
    const [, id, action] = m;
    const draft = getDraft(id);
    if (!draft) return json(res, 404, { ok: false, error: 'brouillon inconnu' }), true;
    if (action === 'reject') { removeDraft(id); return json(res, 200, { ok: true, removed: id }), true; }
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { ok: false, error: 'JSON invalide' }), true; }
    const merged = { ...draft, ...Object.fromEntries(['mot', 'traduction', 'exemple', 'astuce', 'infos'].filter(k => typeof body[k] === 'string').map(k => [k, body[k]])) };
    if (!merged.mot.trim() || !merged.traduction.trim()) return json(res, 400, { ok: false, error: 'mot et traduction requis' }), true;
    try {
      const user = await requireUser(sb);
      const wordId = await insertWord(sb, user.id, merged);
      removeDraft(id);
      ctx.log && ctx.log(`brouillon ${id} ajouté au vocabulaire (${wordId})`);
      return json(res, 200, { ok: true, wordId }), true;
    } catch (e) {
      return json(res, 502, { ok: false, error: e.message }), true;
    }
  }
  return false;
}
