/**
 * pi.mjs — the Program Increment, read through pi.js itself (loaded under
 * Node by srs.mjs::loadLazyPI). `pi.end` is the last day INCLUSIVE; sprints
 * come from buildSprints() with `endInclusive`, never from `end`.
 */
import { isoShort, plural } from './fmt.mjs';

export function piOf(LazyPI, profile) {
  const raw = profile && profile.pi && typeof profile.pi === 'object' && Object.keys(profile.pi).length ? profile.pi : null;
  return raw ? LazyPI.normalise(JSON.parse(JSON.stringify(raw))) : null;
}

export function piHeadline(LazyPI, pi) {
  if (!pi) return 'Pas de PI défini (pi.html).';
  const c = LazyPI.cockpit(pi);
  if (!c.hasPI) return `PI « ${pi.name || 'sans nom'} » sans dates valides.`;
  const L = [];
  const name = pi.name ? `« ${pi.name} »` : 'PI';
  if (c.status === 'before') L.push(`${name} commence le ${isoShort(pi.start)} (${plural(LazyPI.daysBetween(new Date(new Date().setHours(0,0,0,0)), LazyPI.parseD(pi.start)), 'jour')}), ${plural(c.sprintCount, 'sprint')} de ${pi.sprintLen} jours.`);
  else if (c.status === 'after') L.push(`${name} est terminé depuis le ${isoShort(pi.end)}.`);
  else {
    const sp = c.currentSprint;
    L.push(`${name} : jour ${c.daysElapsed}/${c.totalDays} (${Math.round(c.pctThrough)} %), fin le ${isoShort(pi.end)} dans ${plural(c.daysRemaining, 'jour')}.` +
      (sp ? ` Sprint ${sp.name}/${sp.of} : jour ${sp.dayInSprint}/${sp.totalDays}, se termine le ${isoShort(sp.end)} (${plural(sp.daysLeft, 'jour restant', 'jours restants')}).` : ''));
  }
  if (c.nextRelease) L.push(`Prochaine release : « ${c.nextRelease.name} » le ${isoShort(c.nextRelease.date)} (dans ${plural(c.nextRelease.daysAway, 'jour')}, ${plural(c.nextRelease.features, 'feature')}).`);
  else L.push('Aucune release à venir dans le PI.');
  if (c.lateReleases.length) L.push(`Releases dont la date est passée : ${c.lateReleases.map(r => `« ${r.name} » (${isoShort(r.date)})`).join(', ')}.`);
  if (!c.whole) L.push(`Attention : la fenêtre ne tombe pas sur un nombre entier de sprints (reste ${plural(c.remainderDays, 'jour')}).`);
  return L.join('\n');
}

export function piDetail(LazyPI, pi, volet = 'tout') {
  if (!pi) return 'Pas de PI défini (pi.html). Rien à détailler.';
  const L = [piHeadline(LazyPI, pi)];
  const sprints = LazyPI.buildSprints(pi);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cur = LazyPI.sprintIndexOf(today, sprints);
  if (volet === 'sprints' || volet === 'tout') {
    L.push('', 'SPRINTS');
    for (const s of sprints) {
      L.push(`• ${s.name} : du ${isoShort(LazyPI.isoD(s.start))} au ${isoShort(LazyPI.isoD(s.endInclusive))}${s.partial ? ` (${plural(s.days, 'jour')}, partiel)` : ''}${s.index === cur && today >= s.start && today < s.end ? ' ← en cours' : ''}`);
    }
    if (!sprints.length) L.push('• aucune grille : dates manquantes');
  }
  if (volet === 'releases' || volet === 'tout') {
    L.push('', 'RELEASES');
    const rel = pi.releases.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const r of rel) {
      const feats = pi.features.filter(f => { const m = LazyPI.matchRelease(f.fixVersion, pi); return m && m.id === r.id; });
      L.push(`• « ${r.name} » prod ${r.date ? isoShort(r.date) : 'sans date'}${r.testDate ? `, test ${isoShort(r.testDate)}` : ''} — ${plural(feats.length, 'feature')}`);
    }
    if (!rel.length) L.push('• aucune release');
  }
  if (volet === 'features' || volet === 'tout') {
    L.push('', `FEATURES (${pi.features.length})`);
    const sorted = LazyPI.featuresSorted(pi);
    const byRelease = new Map();
    for (const f of sorted) {
      const r = LazyPI.releaseForFeature(f, pi);
      const k = r ? `« ${r.name} »` : 'sans release';
      if (!byRelease.has(k)) byRelease.set(k, []);
      byRelease.get(k).push(f);
    }
    for (const [k, fs] of byRelease) {
      L.push(`${k} :`);
      for (const f of fs.slice(0, 40)) {
        const r = LazyPI.releaseForFeature(f, pi);
        const idx = r && r.date ? LazyPI.defaultSprintIndex(r.date, sprints) + (f.offset || 0) : -1;
        const sp = idx >= 0 && sprints[idx] ? sprints[idx].name : '';
        L.push(`  - ${f.key ? f.key + ' ' : ''}${f.name}${f.epic ? ` [${f.epic}]` : ''}${sp ? ` · ${sp}` : ''}`);
      }
      if (fs.length > 40) L.push(`  … et ${fs.length - 40} autres`);
    }
    if (!sorted.length) L.push('• aucune feature');
  }
  if (volet === 'tout' && (pi.off.length || pi.testing.length)) {
    L.push('');
    if (pi.off.length) L.push('CONGÉS : ' + pi.off.map(o => `${o.name} ${isoShort(o.start)}→${isoShort(o.end)}${o.reason ? ` (${o.reason})` : ''}`).join(' · '));
    if (pi.testing.length) L.push('TESTS : ' + pi.testing.map(t => `${t.label} ${isoShort(t.start)}→${isoShort(t.end)}`).join(' · '));
  }
  return L.join('\n');
}
