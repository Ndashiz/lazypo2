#!/usr/bin/env node
/** token.mjs — prints the connector token, on purpose, on demand, and nowhere else. */
import { loadConfig } from './lib/config.mjs';
try {
  const cfg = loadConfig();
  process.stdout.write(cfg.token + '\n');
  if (process.stdout.isTTY) {
    process.stderr.write('(valeur de l\'en-tête du connecteur : telle quelle, ou « Bearer <jeton> » ; ne la colle nulle part ailleurs)\n');
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
