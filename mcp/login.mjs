#!/usr/bin/env node
/**
 * login.mjs — sign the MCP server in as you, once.
 *
 * Email + password are asked in the terminal (the password is not echoed) and
 * sent to Supabase; only the resulting session (access + refresh token) is
 * written to ~/.config/lazypo-mcp/session.json. The password is never stored.
 *
 *   node mcp/login.mjs            # sign in
 *   node mcp/login.mjs --status   # who is signed in
 *   node mcp/login.mjs --logout   # revoke and forget the session
 */
import { createInterface } from 'node:readline';
import { CONFIG_PATH, SESSION_PATH, readJson, writeJsonPrivate } from './lib/config.mjs';
import { makeClient } from './lib/supa.mjs';

const args = process.argv.slice(2);
const sb = makeClient();

// One readline for the whole dialogue; lines are queued so a pasted or piped
// answer is never lost; the password is asked with the echo off.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
if (typeof rl._writeToOutput === 'function') {
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = s => { if (!muted || s.includes('Mot de passe')) write(s); };
}
const queued = [], waiting = [];
rl.on('line', l => { const w = waiting.shift(); if (w) w(l); else queued.push(l); });
rl.on('close', () => { while (waiting.length) waiting.shift()(null); });
function ask(question, { muted: m = false } = {}) {
  return new Promise(resolve => {
    muted = m;
    rl.setPrompt(question);
    rl.prompt();
    const done = l => { muted = false; if (m) process.stdout.write('\n'); resolve(l == null ? '' : String(l).trim()); };
    if (queued.length) done(queued.shift()); else waiting.push(done);
  });
}

async function status() {
  const { data } = await sb.auth.getSession();
  const s = data && data.session;
  if (!s) { console.log(`Pas de session (${SESSION_PATH} absent ou expiré).`); return false; }
  console.log(`Connecté : ${s.user.email} (uid ${s.user.id}) — jeton d'accès valable jusqu'à ${new Date(s.expires_at * 1000).toLocaleString('fr-BE')}, renouvelé à la demande.`);
  return true;
}

if (args.includes('--status')) {
  await status();
} else if (args.includes('--logout')) {
  await sb.auth.signOut().catch(() => {});
  console.log('Session révoquée et oubliée.');
} else {
  const cfg = readJson(CONFIG_PATH, {});
  const email = (await ask(`E-mail Supabase${cfg.email ? ` [${cfg.email}]` : ''} : `)) || cfg.email;
  if (!email) { console.error('E-mail requis.'); process.exit(1); }
  const password = await ask('Mot de passe : ', { muted: true });
  if (!password) { console.error('Mot de passe requis.'); process.exit(1); }
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) { console.error(`Connexion refusée : ${error ? error.message : 'pas de session'}`); process.exit(1); }
  if (cfg && cfg.token && cfg.email !== email) writeJsonPrivate(CONFIG_PATH, { ...cfg, email });
  await status();
  console.log(`Session écrite dans ${SESSION_PATH}. Le serveur la reprend tout seul.`);
}
rl.close();
