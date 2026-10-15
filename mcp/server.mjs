#!/usr/bin/env node
/**
 * server.mjs — LazyPO by voice: the MCP server behind the Claude app connector.
 *
 *   127.0.0.1:<port>/mcp     the connector (guarded: provenance → token → Host → ceiling)
 *   127.0.0.1:<port>/health  "ok" — check it THROUGH the tunnel, not locally
 *   127.0.0.1:<port>/        the local page (drafts) — loopback only, 404 through the tunnel
 *
 * Stateless MCP over streamable HTTP: one McpServer + transport per request,
 * nothing to lose between two calls. Run `node mcp/setup.mjs` first.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig, ConfigError, CONFIG_PATH, ANTHROPIC_RANGES } from './lib/config.mjs';
import { guardMcp, isLocalFace, RateLimiter, loopbackHosts } from './lib/guard.mjs';
import { loadSrs, loadLazyPI } from './lib/srs.mjs';
import { makeClient } from './lib/supa.mjs';
import { registerTools } from './lib/tools.mjs';
import { handleLocal } from './lib/local.mjs';

const VERSION = '1.0.0';

function stamp() { return new Date().toISOString().slice(11, 19); }

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('body trop grand')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function buildMcpServer(ctx) {
  const server = new McpServer({ name: 'lazypo', version: VERSION }, {
    instructions: "LazyPO est la boîte à outils personnelle de l'utilisateur : quiz de vocabulaire néerlandais (répétition espacée), Program Increment, cockpit. " +
      "Commencer par lazypo_point. Une série de quiz = lazypo_serie une fois, puis les questions à l'oral, puis lazypo_resultats une fois. À l'oral, chaque appel s'entend : ne pas en enchaîner.",
  });
  registerTools(server, ctx);
  return server;
}

/** The HTTP server, not yet listening. Exported for the tests. */
export function createApp(ctx) {
  const limiter = ctx.limiter || new RateLimiter(ctx.cfg.rateLimitPerMinute);
  const ranges = ctx.ranges || ANTHROPIC_RANGES;
  const log = ctx.log || (m => console.log(`[${stamp()}] ${m}`));
  ctx.log = log;

  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://local');
    try {
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('ok\n');
        return;
      }
      if (url.pathname === '/mcp') {
        const g = guardMcp(req, ctx.cfg, limiter, ranges);
        if (!g.ok) { log(`/mcp refusé (${g.reason}) ${req.method}`); res.writeHead(404).end(); return; }
        // Stateless: no session to resume, so no standalone SSE stream (GET) and nothing to DELETE.
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
        let parsed;
        if (req.method === 'POST') {
          const raw = await readBody(req);
          try { parsed = raw ? JSON.parse(raw) : undefined; } catch { res.writeHead(400).end(); return; }
          const calls = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
          for (const c of calls) {
            if (c.method === 'tools/call') log(`appel ${c.params && c.params.name} depuis ${g.ip}`);
            else if (c.method && !/^notifications\//.test(c.method)) log(`${c.method} depuis ${g.ip}`);
          }
        }
        const server = buildMcpServer(ctx);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
        await server.connect(transport);
        await transport.handleRequest(req, res, parsed);
        return;
      }
      if (isLocalFace(req, ctx.cfg.port)) {
        if (await handleLocal(req, res, url, ctx)) return;
      }
      res.writeHead(404).end();
    } catch (e) {
      log(`erreur ${req.method} ${url.pathname} : ${e.message}`);
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    }
  });
}

async function main() {
  let cfg;
  try { cfg = loadConfig(); } catch (e) {
    if (e instanceof ConfigError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const srs = loadSrs();
  const LazyPI = loadLazyPI();
  const sb = makeClient();
  const ctx = { cfg, srs, LazyPI, sb };
  const app = createApp(ctx);

  app.listen(cfg.port, '127.0.0.1', async () => {
    let who = 'PAS DE SESSION → node mcp/login.mjs';
    try { const { data } = await sb.auth.getSession(); if (data && data.session) who = `connecté en tant que ${data.session.user.email}`; } catch { /* keep */ }
    console.log(`LazyPO MCP v${VERSION} — http://127.0.0.1:${cfg.port}  (/mcp connecteur · / page locale · /health)`);
    console.log(`  config  : ${CONFIG_PATH} · jeton : \`node mcp/token.mjs\` (jamais affiché ici)`);
    console.log(`  session : ${who}`);
    console.log(`  garde   : provenance ${cfg.provenance}${cfg.provenance === 'anthropic' ? ` (${ANTHROPIC_RANGES.join(', ')})` : ''} · Host ${loopbackHosts(cfg.port).concat(cfg.publicHosts).join(', ')} · ${cfg.rateLimitPerMinute} appels/min`);
    console.log(`  mots dictés : ${cfg.vocabularyWrites === 'draft' ? 'brouillon, à valider sur la page locale' : 'ajout direct au vocabulaire'}`);
    console.log(`  tunnel  : vérifier https://<hôte public>/health À TRAVERS le tunnel, pas en local`);
  });
  app.on('error', e => { console.error(`Impossible d'écouter sur 127.0.0.1:${cfg.port} : ${e.message}`); process.exit(1); });
  const stop = () => { console.log('Arrêt.'); app.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
