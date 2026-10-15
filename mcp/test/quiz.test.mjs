import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrs, loadLazyPI } from '../lib/srs.mjs';
import { composeSeries, formatSeries, planResults, formatResults, learningState, findWords, normalise, articleOf, newWordsIntroducedToday } from '../lib/quiz.mjs';
import { formatPoint } from '../lib/point.mjs';
import { piDetail, piOf } from '../lib/pi.mjs';

const srs = loadSrs();
const DAY = 86400000;
const now = Date.parse('2026-10-15T10:00:00+02:00');
const ago = d => new Date(now - d * DAY).toISOString();

function word(i, extra = {}) {
  return { id: `w${i}`, source_word: `de woord${i}`, target_translation: `mot${i} / terme${i}`, example_sentence: `Dit is woord${i}.`, tips: '', extra_info: '', created_at: ago(30 - i), is_system: false, flagged_at: null, ...extra };
}
const words = Array.from({ length: 30 }, (_, i) => word(i));
words[3].flagged_at = ago(1);
const progress = {
  w0: { word_id: 'w0', attempts: 5, correct: 4, last_tested: ago(10), interval_days: 3, ease_factor: 2.3, stage: 'recv', lapses: 1, recent: [1, 1, 0, 1, 1] },   // due
  w1: { word_id: 'w1', attempts: 9, correct: 8, last_tested: ago(2), interval_days: 30, ease_factor: 2.5, stage: 'prod', lapses: 1, recent: [1,1,1,1,1,1,1,1] },  // not due, production
  w2: { word_id: 'w2', attempts: 8, correct: 2, last_tested: ago(3), interval_days: 1, ease_factor: 1.3, stage: 'recv', lapses: 6, recent: [0,0,1,0,0] },         // leech, due
  w5: { word_id: 'w5', attempts: 3, correct: 3, last_tested: ago(8), interval_days: 2, ease_factor: 2.5, stage: 'prod', lapses: 0, recent: [1,1,1] },               // due, production
  w6: { word_id: 'w6', attempts: 1, correct: 1, last_tested: new Date(now - 3600000).toISOString(), first_tested: new Date(now - 3600000).toISOString(), interval_days: 1, stage: 'learn', lapses: 0, recent: [1] }, // introduced today
};
const data = { words, progress, log: [], settings: { new_per_day: 8 }, xp: { total_xp: 1200, current_streak_days: 4, last_active_date: '2026-10-14' }, sessions: [], missing: [] };

test('helpers: normalise, article', () => {
  assert.equal(normalise('Het Huis'), 'huis');
  assert.equal(normalise("l'école"), 'ecole');
  assert.equal(articleOf('de fiets'), 'de'); assert.equal(articleOf('fietsen'), '');
  assert.equal(newWordsIntroducedToday(progress, [], now), 1);
});

test('compose « jour »: due reviews first, new words within the budget, no undue filler', () => {
  const s = composeSeries(srs, data, { size: 8, mode: 'jour', now, rnd: () => 0.42 });
  assert.ok(s.key.startsWith('voice-2026-10-15-'));
  const ids = s.items.map(i => i.id);
  assert.ok(ids.includes('w0') && ids.includes('w2') && ids.includes('w5'), 'all due words asked');
  assert.ok(!ids.includes('w1'), 'not due → not asked');
  assert.ok(!ids.includes('w6'), 'already asked today → not asked');
  assert.equal(s.budgetLeft, 7);
  const news = s.items.filter(i => i.isNew);
  assert.ok(news.length >= 1 && news.length <= 5);
  assert.equal(s.items.find(i => i.id === 'w5').direction, 'reverse', 'production word asked FR→NL');
  assert.equal(s.items.find(i => i.id === 'w0').direction, 'forward');
  assert.equal(new Set(ids).size, ids.length, 'a word at most once');
  const txt = formatSeries(s, learningState(srs, data, now));
  assert.match(txt, /SÉRIE voice-/);
  assert.match(txt, /lazypo_resultats/);
  assert.match(txt, /Rien n'est écrit/);
  assert.match(txt, /\[NOUVEAU\]/);
});

test('compose « revisions » never adds new words; « flagges » takes the flagged', () => {
  const r = composeSeries(srs, data, { size: 8, mode: 'revisions', now });
  assert.ok(r.items.every(i => !i.isNew));
  assert.equal(r.items.length, 3);
  const f = composeSeries(srs, data, { size: 8, mode: 'flagges', now });
  assert.deepEqual(f.items.map(i => i.id), ['w3']);
});

test('an empty series says why and that the vocabulary is not empty', () => {
  const s = composeSeries(srs, { ...data, settings: { new_per_day: 1 } }, { size: 8, mode: 'nouveaux', now });
  assert.equal(s.items.length, 0);
  const txt = formatSeries(s, learningState(srs, data, now));
  assert.match(txt, /budget de nouveaux mots du jour est épuisé/);
  assert.match(txt, /n'est pas vide/);
});

test('planResults: code refuses what the description only explains', () => {
  const s = composeSeries(srs, data, { size: 8, mode: 'jour', now, rnd: () => 0.42 });
  const n0 = s.items.find(i => i.id === 'w0').n;
  const n2 = s.items.find(i => i.id === 'w2').n;
  const prog = { ...progress, w2: { ...progress.w2, last_tested: new Date(now - 1000).toISOString() } };   // graded today meanwhile
  const plan = planResults(srs, s, [
    { n: n0, note: 3 }, { n: n0, note: 1 }, { n: 99, note: 3 }, { n: n2, note: 2 }, { n: s.items[0].n === n0 ? s.items[1].n : s.items[0].n, note: 7 },
  ], prog, now);
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0].item.id, 'w0');
  assert.equal(plan.ops[0].state.stage, 'prod', 'reception held at 7 days → production (interval reduced to a third)');
  assert.equal(plan.ops[0].log.was_due, true);
  const whys = plan.refused.map(r => r.why).join(' | ');
  assert.match(whys, /déjà noté dans cet appel/);
  assert.match(whys, /pas dans cette série/);
  assert.match(whys, /déjà noté aujourd'hui/);
  assert.match(whys, /hors 1–4/);
  const txt = formatResults(plan, learningState(srs, data, now), srs, s, true);
  assert.match(txt, /1 réponse enregistrée/);
  assert.match(txt, /Refusées par le code/);
  assert.match(txt, /État après/);
});

test('lookup: exact beats prefix beats substring, article ignored', () => {
  const hits = findWords(words, 'Woord1');
  assert.equal(hits[0].id, 'w1');
  assert.ok(hits.length > 1 && hits.length <= 5, 'prefix matches follow');
  assert.equal(findWords(words, 'terme7')[0].id, 'w7');
  assert.equal(findWords(words, 'zzz').length, 0);
});

test('le point: one text, says the empty parts', () => {
  const LazyPI = loadLazyPI();
  const profile = { username: 'simon', pi: { name: 'PI 26.4', start: '2026-10-01', end: '2026-11-25', sprintLen: 14, releases: [{ name: 'Monthly Release November 2026', date: '2026-11-05' }], features: [{ name: 'F1', fixVersion: 'Monthly Release November 2026' }] }, countdowns: [{ name: 'REACH', date: '2026-12-01' }], todo_tasks: [{ id: 't1', name: 'Préparer la démo', deadline: '2026-10-20', done: false }, { id: 't2', name: 'fait', done: true }] };
  const txt = formatPoint({ srs, LazyPI, data, profile, drafts: [{ mot: 'de jas', createdAt: ago(0) }], now });
  assert.match(txt, /LE POINT LAZYPO/);
  assert.match(txt, /Révisions dues maintenant : 3/);
  assert.match(txt, /1 déjà découvert aujourd'hui → 7 restants/);
  assert.match(txt, /1 mot dicté attend validation/);
  assert.match(txt, /« PI 26.4 »/);
  assert.match(txt, /Prochaine release/);
  assert.match(txt, /1 tâche ouverte/);
  assert.match(txt, /REACH/);
  const empty = formatPoint({ srs, LazyPI, data: { ...data, words: [], progress: {} }, profile: {}, drafts: [], now });
  assert.match(empty, /vocabulaire est vide/);
  assert.match(empty, /Pas de PI défini/);
  const detail = piDetail(LazyPI, piOf(LazyPI, profile), 'tout');
  assert.match(detail, /S4 : du 12 nov/);
  assert.match(detail, /F1/);
});
