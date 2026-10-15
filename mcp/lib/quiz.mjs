/**
 * quiz.mjs — the Dutch quiz, by ear.
 *
 * Pure functions over loaded data (words, progress, answer log, settings);
 * the Supabase writes sit apart at the bottom. Everything that decides is
 * delegated to the SRS block borrowed from quiz.html (see srs.mjs).
 */
import { randomUUID } from 'node:crypto';
import { dayKey, localMidnight, shortDate, pct, plural } from './fmt.mjs';

export const STAGE_LABEL = { new: 'nouveau', learn: 'apprentissage', recv: 'réception', prod: 'production' };
export const MODES = ['jour', 'revisions', 'nouveaux', 'flagges'];

/* ── Text helpers ─────────────────────────────────────────────── */
export function normalise(s) {
  return String(s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^(le |la |les |l'|un |une |des |de |het |een |the |an |a )/, '')
    .trim();
}
export function articleOf(source) {
  const m = /^(de|het|een)\s+/i.exec(String(source || '').trim());
  return m ? m[1].toLowerCase() : '';
}
export function alternatives(target) {
  return String(target || '').split(' / ').map(s => s.trim()).filter(Boolean);
}
function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ── State of the day ─────────────────────────────────────────── */
/** New words first asked today, every device — first_tested or the journal. */
export function newWordsIntroducedToday(progress, log, now = Date.now()) {
  const midnight = localMidnight(now);
  const ids = new Set();
  for (const p of Object.values(progress)) {
    if (p.first_tested && new Date(p.first_tested).getTime() >= midnight) ids.add(p.word_id);
  }
  for (const r of log) {
    if (r.is_new && !r.is_relearn && new Date(r.answered_at).getTime() >= midnight) ids.add(r.word_id);
  }
  return ids.size;
}

export function learningState(srs, { words, progress, log, settings }, now = Date.now()) {
  const active = words.filter(w => w && w.id);
  let due = 0, leeches = 0, fresh = 0, flagged = 0, acquired = 0;
  for (const w of active) {
    const p = progress[w.id];
    if (w.flagged_at) flagged++;
    if (!p || !p.attempts) { fresh++; continue; }
    if (srs.srsIsAcquired(p)) acquired++;
    if (srs.srsIsDue(p, now)) { due++; if (srs.srsIsLeech(p)) leeches++; }
  }
  const introduced = newWordsIntroducedToday(progress, log, now);
  const budget = Math.max(0, (settings.new_per_day || 8) - introduced);
  const kpis = srs.srsKpis({ log, progress, words: active, now });
  return { total: active.length, due, leeches, fresh, flagged, acquired, introduced, newPerDay: settings.new_per_day || 8, budget, kpis };
}

/* ── Composing a series ───────────────────────────────────────── */
export function composeSeries(srs, data, { size = 8, mode = 'jour', now = Date.now(), rnd = Math.random } = {}) {
  const { words, progress, log, settings } = data;
  size = Math.max(3, Math.min(20, Math.round(Number(size) || 8)));
  if (!MODES.includes(mode)) mode = 'jour';
  const pool = words.filter(w => w && w.id && w.source_word && w.target_translation);
  const budgetLeft = Math.max(0, (settings.new_per_day || 8) - newWordsIntroducedToday(progress, log, now));
  const k = srs.srsKpis({ log, progress, words: pool, now });
  const leechPct = k.leechShare != null && k.leechShare > 0.15 ? 0.05 : 0.10;

  let picked = [], stats = {};
  if (mode === 'flagges') {
    const flagged = pool.filter(w => w.flagged_at);
    picked = shuffle(flagged, rnd).slice(0, size).map(w => ({ word: w, isNew: !(progress[w.id] && progress[w.id].attempts) }));
    stats = { flagged: flagged.length };
  } else if (mode === 'nouveaux') {
    const fresh = pool.filter(w => !(progress[w.id] && progress[w.id].attempts));
    const n = Math.min(size, budgetLeft, fresh.length);
    picked = srs.srsNewWordOrder(fresh).slice(0, n).map(w => ({ word: w, isNew: true }));
    stats = { fresh: fresh.length, budgetLeft };
  } else {
    const plan = srs.srsComposeDaily({
      words: pool, progress, now, size,
      budgetLeft: mode === 'revisions' ? 0 : budgetLeft,
      leechPct, bias: null, rnd,
    });
    picked = plan.items;
    stats = plan.stats;
  }

  const items = picked.map(({ word, isNew }, i) => {
    const p = progress[word.id];
    // Voice has no "fill the blank": a production word is asked FR → NL.
    const direction = isNew ? 'forward' : (srs.srsDirection(word, p, () => 1) === 'forward' ? 'forward' : 'reverse');
    return {
      n: i + 1,
      id: word.id,
      source: word.source_word,
      target: word.target_translation,
      answers: alternatives(word.target_translation),
      article: articleOf(word.source_word),
      example: word.example_sentence || '',
      tips: word.tips || '',
      extra: word.extra_info || '',
      stage: isNew ? 'new' : srs.srsStage(p),
      isNew: !!isNew,
      flagged: !!word.flagged_at,
      direction,
    };
  });

  return {
    key: 'voice-' + dayKey(now) + '-' + randomUUID().slice(0, 8),
    createdAt: new Date(now).toISOString(),
    mode, size, items, stats, budgetLeft,
  };
}

export function formatSeries(series, state) {
  const { items, mode, stats } = series;
  const L = [];
  if (!items.length) {
    L.push(`Aucune question à poser en mode « ${mode} » : ` + (
      mode === 'flagges' ? 'aucun mot n\'est dans « Étudier plus tard ».' :
      mode === 'nouveaux' ? (series.budgetLeft === 0 ? `le budget de nouveaux mots du jour est épuisé (${state.newPerDay}/jour, ${state.introduced} déjà découverts aujourd'hui).` : 'il ne reste aucun mot jamais posé.') :
      `rien n'est dû pour l'instant (prochaine révision plus tard) et ${series.budgetLeft === 0 ? 'le budget de nouveaux mots du jour est épuisé' : 'aucun mot nouveau n\'attend'}.`));
    L.push(`Le vocabulaire n'est pas vide : ${plural(state.total, 'mot')}, ${plural(state.due, 'révision due')}, ${plural(state.fresh, 'mot jamais posé', 'mots jamais posés')}. Rien n'a été écrit.`);
    return L.join('\n');
  }
  const nNew = items.filter(i => i.isNew).length, nRev = items.length - nNew;
  L.push(`SÉRIE ${series.key} — ${plural(items.length, 'question')} (${plural(nRev, 'révision')}, ${plural(nNew, 'nouveau mot', 'nouveaux mots')})` +
    (stats.leeches != null ? ` · ${plural(stats.due || 0, 'révision due')} au total, ${plural(stats.leeches, 'sangsue')}` : '') +
    ` · budget nouveaux restant : ${series.budgetLeft}.`);
  L.push('Rien n\'est écrit tant que lazypo_resultats n\'a pas reçu les notes de cette série.');
  L.push('');
  L.push('PROTOCOLE À L\'ORAL — une question à la fois, attendre la réponse, dire si c\'est juste, puis la suivante.');
  L.push('• NL→FR : dire le mot néerlandais (avec son article), demander le français. FR→NL : dire le français, demander le néerlandais AVEC l\'article (de/het).');
  L.push('• Mot NOUVEAU : le présenter d\'abord (mot, article, traduction, phrase d\'exemple), puis demander s\'il le connaissait. Note 4 s\'il le savait déjà, 1 sinon — rater un mot nouveau n\'est pas un oubli.');
  L.push('• Notes : 1 = raté ou passé · 2 = juste mais hésitant, approximatif, ou article faux · 3 = juste · 4 = juste et immédiat.');
  L.push('• L\'astuce peut être donnée si la personne hésite. Les infos « après » ne se révèlent qu\'une fois la réponse donnée.');
  L.push('• À la fin : lazypo_resultats({ serie: "' + series.key + '", notes: [{ n: 1, note: 3 }, …] }). Une note par mot, 1 à 4.');
  L.push('');
  for (const it of items) {
    const tag = it.isNew ? 'NOUVEAU' : STAGE_LABEL[it.stage] || it.stage;
    const dir = it.direction === 'forward' ? 'NL→FR' : 'FR→NL';
    const q = it.direction === 'forward'
      ? `demander : « ${it.source} » → attendu : ${it.answers.map(a => `« ${a} »`).join(' ou ')}`
      : `demander : « ${it.target} » → attendu : « ${it.source} »${it.article ? ` (article : ${it.article})` : ''}`;
    let line = `${it.n}. [${tag}${it.flagged ? ' · flaggé' : ''}] ${dir} — ${q}`;
    if (it.example) line += ` · exemple : « ${it.example} »`;
    if (it.tips) line += ` · astuce : ${it.tips}`;
    if (it.extra) line += ` · après : ${it.extra}`;
    L.push(line);
  }
  return L.join('\n');
}

/* ── Grading a series ─────────────────────────────────────────── */
/**
 * Decide what each note does. Pure: returns operations + what was refused.
 * The code refuses, the description only explains:
 *   - a note for a word that was not in the series,
 *   - a word already graded today (first attempt only, like the web),
 *   - a grade outside 1–4, a duplicate note for the same word.
 */
export function planResults(srs, series, notes, progress, now = Date.now()) {
  const ops = [], refused = [];
  const seen = new Set();
  const midnight = localMidnight(now);
  for (const raw of notes || []) {
    const n = Number(raw && raw.n);
    const grade = Math.round(Number(raw && raw.note));
    const item = series.items.find(it => it.n === n) || (raw && raw.id ? series.items.find(it => it.id === raw.id) : null);
    if (!item) { refused.push({ n: raw && (raw.n ?? raw.id), why: 'pas dans cette série' }); continue; }
    if (seen.has(item.id)) { refused.push({ n: item.n, why: 'déjà noté dans cet appel' }); continue; }
    if (!(grade >= 1 && grade <= 4)) { refused.push({ n: item.n, why: `note ${raw && raw.note} hors 1–4` }); continue; }
    const p = progress[item.id] || null;
    if (p && p.last_tested && new Date(p.last_tested).getTime() >= midnight) {
      refused.push({ n: item.n, why: 'déjà noté aujourd\'hui (seul le premier essai compte)' });
      continue;
    }
    seen.add(item.id);
    const wasLeech = srs.srsIsLeech(p);
    const { state, log } = srs.srsNext(p, grade, now);
    ops.push({ item, grade, prev: p, state, log, wasLeech });
  }
  return { ops, refused };
}

export function formatResults({ ops, refused }, state, srs, series, posted) {
  const L = [];
  const correct = ops.filter(o => o.grade >= 2);
  if (!ops.length) {
    L.push('Aucune note enregistrée.');
  } else {
    L.push(`${plural(ops.length, 'réponse enregistrée', 'réponses enregistrées')} pour la série ${series.key} : ${correct.length} juste${correct.length > 1 ? 's' : ''}, ${ops.length - correct.length} ratée${ops.length - correct.length > 1 ? 's' : ''}.`);
    const missed = ops.filter(o => o.grade === 1);
    if (missed.length) L.push('Ratés, reviennent demain : ' + missed.map(o => `« ${o.item.source} » (${o.item.target})`).join(', ') + '.');
    const moved = ops.filter(o => o.grade >= 2 && !o.item.isNew);
    if (moved.length) L.push('Prochaines révisions : ' + moved.map(o => `« ${o.item.source} » dans ${plural(o.state.interval_days, 'jour')}${o.state.stage !== o.log.stage ? ` (→ ${STAGE_LABEL[o.state.stage]})` : ''}`).join(', ') + '.');
    const news = ops.filter(o => o.item.isNew);
    if (news.length) L.push(`${plural(news.length, 'mot nouveau découvert', 'mots nouveaux découverts')} : ` + news.map(o => `« ${o.item.source} »`).join(', ') + ' — revus demain' + (news.some(o => o.grade === 4) ? ' (ou dans 3 jours pour ceux déjà connus)' : '') + '.');
  }
  if (refused.length) L.push('Refusées par le code : ' + refused.map(r => `n° ${r.n} (${r.why})`).join(', ') + '.');
  if (posted === false) L.push('La séance n\'a pas pu être publiée dans le fil (les notes, elles, sont écrites).');
  else if (posted) L.push('Séance publiée dans le fil LazyPO.');
  L.push(`État après : ${plural(state.due, 'révision due', 'révisions dues')} aujourd'hui, budget de nouveaux mots restant ${state.budget}/${state.newPerDay}` +
    (state.kpis && state.kpis.retention != null ? `, rétention 7 jours ${pct(state.kpis.retention)}` : '') + '.');
  return L.join('\n');
}

/* ── Looking a word up ────────────────────────────────────────── */
export function findWords(words, text, limit = 5) {
  const q = normalise(text);
  if (!q) return [];
  const scored = [];
  for (const w of words) {
    const s = normalise(w.source_word), t = normalise(w.target_translation);
    const alts = alternatives(w.target_translation).map(normalise);
    let score = 0;
    if (s === q || alts.includes(q)) score = 3;
    else if (s.startsWith(q) || alts.some(a => a.startsWith(q))) score = 2;
    else if (s.includes(q) || t.includes(q)) score = 1;
    if (score) scored.push({ w, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.w.source_word).localeCompare(String(b.w.source_word)));
  return scored.slice(0, limit).map(x => x.w);
}

export function describeWord(srs, w, p, log, now = Date.now()) {
  const stage = srs.srsStage(p);
  const parts = [`« ${w.source_word} » → « ${w.target_translation} »`];
  if (w.example_sentence) parts.push(`exemple : « ${w.example_sentence} »`);
  if (w.tips) parts.push(`astuce : ${w.tips}`);
  if (w.extra_info) parts.push(`infos : ${w.extra_info}`);
  if (!p || !p.attempts) parts.push('jamais posé');
  else {
    const rate = srs.srsRate(p);
    const nextMs = new Date(p.last_tested).getTime() + Math.max(1, p.interval_days || 1) * 86400000;
    parts.push(`étape ${STAGE_LABEL[stage]}${srs.srsIsAcquired(p) ? ' (acquis)' : ''}, ${p.attempts} réponses, réussite ${pct(rate)}, intervalle ${plural(p.interval_days || 1, 'jour')}, ` +
      (nextMs <= now ? 'DÛ maintenant' : `prochaine révision le ${shortDate(nextMs)}`) +
      (srs.srsIsLeech(p) ? ', sangsue' : ''));
  }
  if (w.flagged_at) parts.push('dans « Étudier plus tard »');
  if (w.is_system) parts.push('mot de la liste système');
  const recent = (log || []).filter(r => r.word_id === w.id).slice(-3);
  if (recent.length) parts.push('dernières réponses : ' + recent.map(r => `${shortDate(r.answered_at)} ${r.correct ? 'juste' : 'raté'}`).join(', '));
  return parts.join(' · ');
}

/* ── Supabase writes (the only ones) ──────────────────────────── */
/** Mirrors quiz.html recordAnswer(): upsert quiz_progress, dropping the
 *  columns the base does not have yet; one journal row per answer. */
export async function writeResults(sb, uid, series, ops, { log = [], profile = null, durationSec = null } = {}) {
  let recentMissing = false, v2Missing = false, journalMissing = false;
  const nowIso = new Date().toISOString();
  for (const o of ops) {
    const { state, log: l, item, grade } = o;
    const base = {
      user_id: uid, word_id: item.id,
      correct: state.correct, attempts: state.attempts, last_tested: state.last_tested,
      ease_factor: state.ease_factor, interval_days: state.interval_days,
    };
    const v2 = { stage: state.stage, lapses: state.lapses };
    if (state.first_tested && (!o.prev || !o.prev.first_tested)) v2.first_tested = state.first_tested;
    for (let attempt = 0; attempt < 3; attempt++) {
      const payload = { ...base, ...(recentMissing ? {} : { recent: state.recent }), ...(v2Missing ? {} : v2) };
      const { error } = await sb.from('quiz_progress').upsert(payload, { onConflict: 'user_id,word_id' });
      if (!error) break;
      const msg = error.message || '';
      if (!recentMissing && /recent/i.test(msg)) { recentMissing = true; continue; }
      if (!v2Missing && /stage|lapses|first_tested/i.test(msg)) { v2Missing = true; continue; }
      throw new Error(`quiz_progress « ${item.source} » : ${msg}`);
    }
    if (!journalMissing) {
      const row = {
        user_id: uid, word_id: item.id, session_key: series.key, mode: 'voice', answered_at: nowIso,
        direction: item.direction, stage: l.stage, grade, correct: grade >= 2, close_match: false,
        first_key_ms: null, total_ms: null,
        is_new: l.stage === 'new', is_relearn: false, is_leech: o.wasLeech,
        was_due: l.was_due, elapsed_days: l.elapsed_days,
        interval_before: l.interval_before, interval_after: l.interval_after,
      };
      const { error } = await sb.from('quiz_answers').insert(row);
      if (error) journalMissing = true;   // table absent: the state is written, the journal is not
    }
  }
  // The session, in the feed — same shape as the web (postMultiSession).
  let posted = null;
  if (ops.length) {
    const name = (profile && profile.username) || 'Simon';
    const payload = {
      user_id: uid, display_name: name, avatar_url: (profile && profile.avatar_url) || null,
      score: ops.filter(o => o.grade >= 2).length, total: ops.length,
      duration_sec: durationSec == null ? null : Math.max(0, Math.round(durationSec)),
      mode: 'vocab', lang: series.mode === 'jour' ? 'daily' : 'voice', direction: 'auto',
      word_ids: ops.map(o => o.item.id),
      words: ops.map(o => ({ source_word: o.item.source, target_translation: o.item.target, language_pair: 'NL→FR', example_sentence: o.item.example || null, tips: o.item.tips || null })),
    };
    let { error } = await sb.from('quiz_sessions').insert(payload);
    if (error && /words/i.test(error.message || '')) { delete payload.words; ({ error } = await sb.from('quiz_sessions').insert(payload)); }
    posted = !error;
  }
  return { posted, recentMissing, v2Missing, journalMissing };
}

export async function insertWord(sb, uid, draft) {
  const row = {
    user_id: uid,
    source_word: String(draft.mot || draft.source_word).trim(),
    target_translation: String(draft.traduction || draft.target_translation).trim(),
    language_pair: 'NL→FR',
    example_sentence: (draft.exemple || draft.example_sentence || '').trim() || null,
    tips: (draft.astuce || draft.tips || '').trim() || null,
    extra_info: (draft.infos || draft.extra_info || '').trim() || null,
  };
  let { data, error } = await sb.from('vocabulary').insert(row).select('id').single();
  if (error && /extra_info/i.test(error.message || '')) {
    delete row.extra_info;
    ({ data, error } = await sb.from('vocabulary').insert(row).select('id').single());
  }
  if (error) throw new Error(`vocabulary : ${error.message}`);
  return data.id;
}

export async function setFlag(sb, uid, wordId, on) {
  const patch = on
    ? { flagged_at: new Date().toISOString(), flag_reason: 'to_study', flag_note: null }
    : { flagged_at: null, flag_reason: null, flag_note: null };
  const { data, error } = await sb.from('vocabulary').update(patch).eq('id', wordId).eq('user_id', uid).select('id');
  if (error) throw new Error(`flag : ${error.message}`);
  if (!data || !data.length) throw new Error('flag : aucune ligne modifiée (RLS ?)');
}
