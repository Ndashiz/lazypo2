/**
 * srs.mjs — the quiz's decision logic, borrowed, not copied.
 *
 * quiz.html keeps every SRS decision in a pure block between the markers
 * `SRS-PURE-BEGIN` and `SRS-PURE-END` (no DOM, no network, no globals), and
 * KNOWLEDGE_QUIZ.md §5 tests it by extracting that block under Node. We do
 * exactly the same, so the voice channel can never drift from the web.
 *
 * pi.js is an IIFE that only needs `window`, `document` and `localStorage`
 * to exist; we hand it inert stand-ins and keep `window.LazyPI`.
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { QUIZ_HTML, PI_JS } from './config.mjs';

const EXPORTS = [
  'DAY_MS', 'GRADE', 'GRADE_LABEL', 'SRS2',
  'srsStage', 'srsRate', 'srsLapses', 'srsIsLeech', 'srsIsAcquired', 'srsIsDue', 'srsRisk',
  'srsGrade', 'srsNext', 'srsDirection', 'srsNewWordOrder', 'srsComposeDaily',
  'srsMedian', 'srsKpis', 'srsRegulate',
];

export function loadSrs(path = QUIZ_HTML) {
  const html = readFileSync(path, 'utf8');
  const a = html.indexOf('/* SRS-PURE-BEGIN');
  const b = html.indexOf('/* SRS-PURE-END');
  if (a < 0 || b < 0 || b < a) throw new Error(`Bloc SRS-PURE introuvable dans ${path}`);
  const code = html.slice(a, b);
  // eslint-disable-next-line no-new-func
  return new Function(code + `\nreturn { ${EXPORTS.join(', ')} };`)();
}

export function loadLazyPI(path = PI_JS) {
  const code = readFileSync(path, 'utf8');
  const noop = () => {};
  const windowShim = { crypto: webcrypto, addEventListener: noop, removeEventListener: noop };
  const documentShim = { addEventListener: noop, removeEventListener: noop, dispatchEvent: noop };
  const storageShim = { getItem: () => null, setItem: noop, removeItem: noop };
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'document', 'localStorage', 'CustomEvent', code + '\nreturn window.LazyPI;');
  const LazyPI = run(windowShim, documentShim, storageShim, class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } });
  if (!LazyPI || typeof LazyPI.buildSprints !== 'function') throw new Error(`window.LazyPI absent après chargement de ${path}`);
  return LazyPI;
}
