/**
 * point.mjs — « le point » : everything needed to start, in one answer.
 * Reads only. Says the empty parts out loud instead of leaving them blank.
 */
import { longDate, clock, shortDate, pct, plural, daysFromNow, dayKey } from './fmt.mjs';
import { learningState, composeSeries } from './quiz.mjs';
import { piOf, piHeadline } from './pi.mjs';

export function formatPoint({ srs, LazyPI, data, profile, drafts, now = Date.now(), vocabularyWrites = 'draft', port = 8787 }) {
  const L = [];
  L.push(`LE POINT LAZYPO — ${longDate(now)}, ${clock(now)}`);
  L.push('');

  /* ── Quiz ── */
  L.push('QUIZ NÉERLANDAIS');
  const s = learningState(srs, data, now);
  if (!s.total) {
    L.push('• Le vocabulaire est vide : aucun mot. Rien à réviser, rien à apprendre tant qu\'aucun mot n\'est ajouté.');
  } else {
    L.push(`• ${plural(s.total, 'mot')} (${plural(s.acquired, 'acquis')}, ${plural(s.fresh, 'jamais posé', 'jamais posés')}, ${plural(s.flagged, 'flaggé « Étudier plus tard »', 'flaggés « Étudier plus tard »')}).`);
    L.push(`• Révisions dues maintenant : ${s.due}${s.leeches ? ` (dont ${plural(s.leeches, 'sangsue')})` : ''}. Nouveaux mots : ${s.newPerDay}/jour, ${s.introduced} déjà découvert${s.introduced > 1 ? 's' : ''} aujourd'hui → ${s.budget} restant${s.budget > 1 ? 's' : ''}.`);
    const preview = composeSeries(srs, data, { size: 8, mode: 'jour', now, rnd: () => 0.5 });
    if (preview.items.length) L.push(`• Une série du jour de 8 ferait ${preview.items.filter(i => !i.isNew).length} révisions + ${preview.items.filter(i => i.isNew).length} nouveaux (lazypo_serie).`);
    else L.push('• Rien à poser pour l\'instant : ni révision due, ni budget de nouveaux mots.');
    const k = s.kpis;
    if (k.answers7) L.push(`• 7 derniers jours : ${plural(k.answers7, 'réponse')}, rétention à l'échéance ${pct(k.retention)}${k.retentionN < 30 ? ' (peu de données)' : ''}${k.backlogDays != null ? `, retard ${k.backlogDays.toFixed(1)} j` : ''}.`);
    else if (data.missing.includes('quiz_answers')) L.push('• Journal des réponses indisponible (table absente) : KPI non mesurables.');
    else L.push('• Aucune réponse dans les 7 derniers jours.');
    if (data.settings.last_reason) L.push(`• Régulateur : ${data.settings.last_reason}`);
  }
  const xp = data.xp;
  if (xp) {
    const last = xp.last_active_date ? daysFromNow(xp.last_active_date) : null;
    const streakNote = last == null ? '' : last === 0 ? ' (actif aujourd\'hui)' : last === -1 ? ' (dernière activité hier — à tenir aujourd\'hui)' : ` (dernière activité le ${shortDate(xp.last_active_date + 'T12:00:00')} : série interrompue)`;
    L.push(`• XP ${xp.total_xp || 0} · ${plural(xp.current_streak_days || 0, 'jour d\'affilée', 'jours d\'affilée')}${streakNote}.`);
  }
  if (data.sessions.length) {
    L.push('• Dernières séances : ' + data.sessions.map(q => `${shortDate(q.created_at)} ${clock(q.created_at)} — ${q.score}/${q.total}${q.lang === 'daily' ? ' (jour)' : q.lang === 'voice' ? ' (voix)' : ''}`).join(' ; ') + '.');
  } else L.push('• Aucune séance publiée pour l\'instant.');
  if (drafts.length) {
    L.push(`• ${plural(drafts.length, 'mot dicté attend', 'mots dictés attendent')} validation sur la page locale du Mac (http://127.0.0.1:${port}/) : ` + drafts.slice(0, 5).map(d => `« ${d.mot} »`).join(', ') + (drafts.length > 5 ? '…' : '') + '. Ils ne sont PAS encore dans le vocabulaire.');
  } else if (vocabularyWrites === 'draft') {
    L.push('• Aucun mot dicté en attente.');
  }

  /* ── PI ── */
  L.push('', 'PI');
  const pi = piOf(LazyPI, profile);
  L.push(...piHeadline(LazyPI, pi).split('\n').map(x => '• ' + x));

  /* ── Dates & tasks (cockpit) ── */
  const cds = Array.isArray(profile && profile.countdowns) ? profile.countdowns.filter(c => c && c.date) : [];
  const upcoming = cds.map(c => ({ ...c, d: daysFromNow(c.date) })).filter(c => c.d != null && c.d >= 0).sort((a, b) => a.d - b.d).slice(0, 3);
  const tasks = Array.isArray(profile && profile.todo_tasks) ? profile.todo_tasks.filter(t => t && !t.done) : [];
  if (upcoming.length || tasks.length) {
    L.push('', 'COCKPIT');
    if (upcoming.length) L.push('• Échéances : ' + upcoming.map(c => `${c.name} ${c.d === 0 ? 'aujourd\'hui' : `dans ${plural(c.d, 'jour')}`} (${shortDate(c.date + 'T12:00:00')})`).join(' · ') + '.');
    if (tasks.length) {
      const sorted = tasks.slice().sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
      L.push(`• ${plural(tasks.length, 'tâche ouverte', 'tâches ouvertes')} : ` + sorted.slice(0, 5).map(t => `${t.name}${t.deadline ? ` (${daysFromNow(t.deadline) < 0 ? 'en retard, ' : ''}${shortDate(t.deadline + 'T12:00:00')})` : ''}`).join(' · ') + (sorted.length > 5 ? ' · …' : '') + '.');
    }
  }
  if (data.missing.length) L.push('', `Note : tables absentes côté Supabase (${data.missing.join(', ')}) — quiz_srs_v2.sql pas passé ; les écritures se dégradent comme sur le web.`);
  L.push('', `Clé du jour : ${dayKey(now)}.`);
  return L.join('\n');
}
