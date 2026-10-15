/**
 * series.mjs — what the voice channel actually asked.
 *
 * lazypo_resultats only accepts notes for a series this server composed, and
 * recently. Series survive a restart (file) and expire after `seriesTtlHours`.
 */
import { SERIES_PATH, readJson, writeJsonPrivate } from './config.mjs';

const KEEP = 30;

function load() {
  const d = readJson(SERIES_PATH, { series: [] });
  return Array.isArray(d.series) ? d.series : [];
}

export function rememberSeries(series) {
  const all = load().filter(s => s.key !== series.key);
  all.push(series);
  writeJsonPrivate(SERIES_PATH, { series: all.slice(-KEEP) });
}

export function recallSeries(key, ttlHours = 12, now = Date.now()) {
  const s = load().find(x => x.key === key);
  if (!s) return { series: null, why: 'série inconnue' };
  const age = now - new Date(s.createdAt).getTime();
  if (age > ttlHours * 3600000) return { series: null, why: `série de plus de ${ttlHours} h` };
  if (s.gradedAt) return { series: null, why: `série déjà notée le ${new Date(s.gradedAt).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' })}` };
  return { series: s, why: null };
}

export function markGraded(key, now = Date.now()) {
  const all = load().map(s => s.key === key ? { ...s, gradedAt: new Date(now).toISOString() } : s);
  writeJsonPrivate(SERIES_PATH, { series: all });
}

export function countSeries() { return load().length; }
