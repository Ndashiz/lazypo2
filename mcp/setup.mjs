#!/usr/bin/env node
/**
 * setup.mjs — creates ~/.config/lazypo-mcp/config.json with a fresh token.
 *
 *   node mcp/setup.mjs                      # first run
 *   node mcp/setup.mjs --rotate             # new token (the connector must be recreated)
 *   node mcp/setup.mjs --port 8787 --host lazypo-mcp.ndashiz.be --direct --provenance any
 *
 * The token is never printed here. `node mcp/token.mjs` prints it on demand.
 */
import { randomBytes } from 'node:crypto';
import { CONFIG_PATH, CONFIG_DIR, DEFAULTS, readJson, writeJsonPrivate, ensureDir } from './lib/config.mjs';

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const value = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const values = n => args.flatMap((a, i) => a === n && args[i + 1] ? [args[i + 1]] : []);

ensureDir();
const existing = readJson(CONFIG_PATH, null);
const cfg = { ...DEFAULTS, ...(existing || {}) };

let tokenNote;
if (!cfg.token || flag('--rotate')) {
  cfg.token = randomBytes(32).toString('base64url');   // 256 bits
  tokenNote = existing && existing.token ? 'Jeton remplacé : supprime et recrée le connecteur dans l\'app Claude.' : 'Jeton créé.';
} else {
  tokenNote = 'Jeton conservé (ajoute --rotate pour en tirer un autre).';
}
if (value('--port')) cfg.port = Number(value('--port')) || cfg.port;
if (values('--host').length) cfg.publicHosts = Array.from(new Set([...(cfg.publicHosts || []), ...values('--host').map(h => h.toLowerCase())]));
if (flag('--direct')) cfg.vocabularyWrites = 'direct';
if (flag('--draft')) cfg.vocabularyWrites = 'draft';
if (value('--provenance')) cfg.provenance = value('--provenance');
if (value('--email')) cfg.email = value('--email');

writeJsonPrivate(CONFIG_PATH, cfg);

console.log(`Configuration écrite : ${CONFIG_PATH} (dossier ${CONFIG_DIR}, 0700 / fichier 0600)`);
console.log(`  ${tokenNote}`);
console.log(`  port ${cfg.port} · provenance ${cfg.provenance} · mots dictés : ${cfg.vocabularyWrites}` +
  (cfg.publicHosts.length ? ` · hosts publics : ${cfg.publicHosts.join(', ')}` : ''));
console.log('');
console.log('Étapes suivantes :');
console.log('  1. node mcp/login.mjs        — connexion Supabase (mot de passe tapé ici, jamais stocké)');
console.log('  2. node mcp/server.mjs       — le serveur, sur 127.0.0.1 uniquement');
console.log('  3. le tunnel, puis le connecteur dans l\'app Claude — voir mcp/README.md');
console.log('  Pour lire le jeton au moment de créer le connecteur : node mcp/token.mjs');
