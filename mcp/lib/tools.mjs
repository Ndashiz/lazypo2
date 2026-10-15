/**
 * tools.mjs — the seven tools, and their descriptions. The description is not
 * documentation: it is the program. The return value is the other half.
 *
 * Two columns (keep them straight when adding a tool):
 *   NOURRIT  lazypo_point · lazypo_serie · lazypo_mot · lazypo_pi
 *   AGIT     lazypo_resultats · lazypo_ajouter_mot · lazypo_marquer_mot
 * Every tool that acts says what changed; every effect the model cannot
 * perceive (the local page) is named in the description AND the result.
 */
import { z } from 'zod';
import { requireUser, loadLearning, loadProfile } from './supa.mjs';
import {
  MODES, composeSeries, formatSeries, learningState, planResults, formatResults,
  writeResults, findWords, describeWord, normalise, insertWord, setFlag, articleOf,
} from './quiz.mjs';
import { formatPoint } from './point.mjs';
import { piOf, piDetail } from './pi.mjs';
import { listDrafts, addDraft } from './drafts.mjs';
import { rememberSeries, recallSeries, markGraded } from './series.mjs';
import { plural } from './fmt.mjs';

const QUAND = "N'appeler que si l'utilisateur parle de LazyPO (la transcription vocale peut donner « lazy po », « lazy peau », « lazipo », « lézipo »), de son quiz ou vocabulaire néerlandais, ou de son PI. ";

const text = (t, isError = false) => ({ content: [{ type: 'text', text: String(t) }], isError });

async function run(ctx, fn) {
  try {
    const user = await requireUser(ctx.sb);
    return text(await fn(user));
  } catch (e) {
    ctx.log && ctx.log(`erreur outil : ${e.message}`);
    return text(`LazyPO n'a pas pu répondre : ${e.message}`, true);
  }
}

export function registerTools(server, ctx) {
  const { cfg, srs, LazyPI, sb } = ctx;
  const localPage = `http://127.0.0.1:${cfg.port}/`;
  const READ  = { readOnlyHint: true, openWorldHint: false };
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  /* ── NOURRIT ─────────────────────────────────────────────────── */
  server.registerTool('lazypo_point', {
    title: 'Le point LazyPO',
    description: QUAND +
      "Rend en UN appel tout ce qu'il faut pour commencer : révisions néerlandaises dues et budget de nouveaux mots du jour, ce que ferait une série du jour, " +
      "KPI des 7 derniers jours, XP et jours d'affilée, dernières séances, mots dictés en attente, PI en cours (sprint, prochaine release), échéances et tâches ouvertes du cockpit. " +
      "À appeler en premier quand l'utilisateur ouvre le sujet ; il n'y a rien d'autre à lire pour démarrer, et le résultat dit lui-même ce qui est vide. Ne modifie rien.",
    inputSchema: {},
    annotations: READ,
  }, async () => run(ctx, async user => {
    const [data, profile] = await Promise.all([loadLearning(sb, user.id), loadProfile(sb, user.id)]);
    return formatPoint({ srs, LazyPI, data, profile, drafts: listDrafts(), vocabularyWrites: cfg.vocabularyWrites, port: cfg.port });
  }));

  server.registerTool('lazypo_serie', {
    title: 'Composer une série de quiz à l\'oral',
    description: QUAND +
      "Compose une série de quiz néerlandais à faire À L'ORAL et la rend ENTIÈRE : pour chaque mot, le sens de la question, la ou les réponses attendues, l'article, la phrase d'exemple, l'astuce (à donner en cas d'hésitation) et les infos à ne révéler qu'après la réponse. " +
      "Un seul appel par série : tout ce qu'il faut pour poser les questions une à une et juger les réponses soi-même est dedans — ne pas rappeler cet outil ni un autre pendant la série. " +
      "Rien n'est écrit par cet appel : la série ne compte qu'une fois lazypo_resultats appelé avec les notes. " +
      "Modes : « jour » (séance du jour : révisions dues + nouveaux mots dans le budget, par défaut), « revisions » (dues seulement), « nouveaux » (jamais posés, dans le budget), « flagges » (mots « Étudier plus tard »). " +
      "Si la série revient vide, le résultat dit pourquoi et ce que contient le vocabulaire : ne pas conclure qu'il est vide.",
    inputSchema: {
      taille: z.number().int().min(3).max(20).optional().describe('nombre de questions, 3 à 20 (défaut 8 ; à l\'oral, 8 à 10 passent bien)'),
      mode: z.enum(MODES).optional().describe('jour (défaut) · revisions · nouveaux · flagges'),
    },
    annotations: READ,
  }, async ({ taille, mode }) => run(ctx, async user => {
    const data = await loadLearning(sb, user.id);
    const series = composeSeries(srs, data, { size: taille || 8, mode: mode || 'jour' });
    if (series.items.length) rememberSeries(series);
    return formatSeries(series, learningState(srs, data));
  }));

  server.registerTool('lazypo_mot', {
    title: 'Chercher un mot du vocabulaire',
    description: QUAND +
      "Cherche un mot dans le vocabulaire de l'utilisateur, par le néerlandais ou le français (article et accents ignorés) et rend sa fiche : traductions, exemple, astuce, infos, étape d'apprentissage, taux de réussite, prochaine révision, flag « Étudier plus tard », dernières réponses. " +
      "Dit explicitement quand rien ne correspond : le mot n'est alors PAS dans le vocabulaire (utile avant lazypo_ajouter_mot). Ne modifie rien.",
    inputSchema: { texte: z.string().min(1).max(80).describe('le mot ou un bout de mot, en néerlandais ou en français') },
    annotations: READ,
  }, async ({ texte }) => run(ctx, async user => {
    const data = await loadLearning(sb, user.id);
    const hits = findWords(data.words, texte, 5);
    if (!hits.length) return `Aucun mot ne correspond à « ${texte} » parmi les ${plural(data.words.length, 'mot')} du vocabulaire. Il n'y est pas.`;
    return `${plural(hits.length, 'mot trouvé', 'mots trouvés')} pour « ${texte} » :\n` + hits.map(w => '• ' + describeWord(srs, w, data.progress[w.id], data.log)).join('\n');
  }));

  server.registerTool('lazypo_pi', {
    title: 'Le détail du PI',
    description: QUAND +
      "Le détail du Program Increment : grille des sprints avec dates, sprint en cours, releases (dates prod et test) avec leurs features, features par release et par sprint, congés et fenêtres de test. " +
      "lazypo_point en donne déjà l'essentiel : n'appeler que pour une question précise sur le PI. Ne modifie rien.",
    inputSchema: { volet: z.enum(['sprints', 'releases', 'features', 'tout']).optional().describe('ce qu\'il faut détailler (défaut : tout)') },
    annotations: READ,
  }, async ({ volet }) => run(ctx, async user => {
    const profile = await loadProfile(sb, user.id);
    return piDetail(LazyPI, piOf(LazyPI, profile), volet || 'tout');
  }));

  /* ── AGIT ────────────────────────────────────────────────────── */
  server.registerTool('lazypo_resultats', {
    title: 'Enregistrer les notes d\'une série',
    description: QUAND +
      "Enregistre les notes d'une série composée par lazypo_serie (sa clé « serie ») : met à jour l'espacement de chaque mot, journalise les réponses et publie la séance dans le fil LazyPO. " +
      "C'est la seule écriture qui compte : sans cet appel, la série n'a pas eu lieu. À appeler une fois, à la fin, avec une note de 1 à 4 par mot posé (n = numéro dans la série). " +
      "Le code refuse : une série inconnue, déjà notée ou de plus de " + cfg.seriesTtlHours + " h, un mot absent de la série, un mot déjà noté aujourd'hui (seul le premier essai compte), une note hors 1–4. " +
      "Rend l'état après l'écriture : réponses enregistrées, mots ratés et leur retour, prochaines révisions, ce qui a été refusé, ce qu'il reste à faire aujourd'hui.",
    inputSchema: {
      serie: z.string().min(6).max(80).describe('la clé rendue par lazypo_serie (SÉRIE voice-…)'),
      notes: z.array(z.object({
        n: z.number().int().min(1).max(20).describe('numéro du mot dans la série'),
        note: z.number().int().min(1).max(4).describe('1 raté · 2 difficile · 3 bien · 4 facile'),
      })).min(1).max(20),
      duree_sec: z.number().int().min(0).max(7200).optional().describe('durée approximative de la série, en secondes'),
    },
    annotations: WRITE,
  }, async ({ serie, notes, duree_sec }) => run(ctx, async user => {
    const { series, why } = recallSeries(serie, cfg.seriesTtlHours);
    if (!series) return `Refusé : ${why}. Rien n'a été écrit. Compose une nouvelle série avec lazypo_serie si l'utilisateur veut continuer.`;
    const [data, profile] = await Promise.all([loadLearning(sb, user.id), loadProfile(sb, user.id)]);
    const plan = planResults(srs, series, notes, data.progress);
    let posted = null;
    if (plan.ops.length) {
      const w = await writeResults(sb, user.id, series, plan.ops, { profile, durationSec: duree_sec });
      posted = w.posted;
      markGraded(series.key);
      for (const o of plan.ops) data.progress[o.item.id] = { ...(o.prev || {}), user_id: user.id, word_id: o.item.id, ...o.state };
    }
    return formatResults(plan, learningState(srs, data), srs, series, posted);
  }));

  const draftMode = cfg.vocabularyWrites === 'draft';
  server.registerTool('lazypo_ajouter_mot', {
    title: draftMode ? 'Dicter un mot (brouillon)' : 'Ajouter un mot au vocabulaire',
    description: QUAND + (draftMode
      ? "Dépose un nouveau mot néerlandais EN BROUILLON, dans un fichier du Mac — PAS dans le vocabulaire : la transcription vocale déforme les mots, l'utilisateur valide ou corrige plus tard sur la page locale " + localPage + " (effet invisible pour toi : seul cet écran-là le montre). "
      : "Ajoute un mot néerlandais directement au vocabulaire de l'utilisateur ; il entrera dans les prochaines séries comme mot nouveau. ") +
      "Vérifie d'abord le doublon et le dit au lieu d'écrire. Toujours fournir : le mot AVEC son article pour un nom (« de fiets », « het huis »), la traduction française (variantes séparées par « / »), une phrase d'exemple en néerlandais qui contient le mot ; au besoin une astuce (indice montré PENDANT la question, qui ne doit pas révéler la réponse) et des infos complémentaires (pluriel, temps du verbe, préposition — révélées seulement APRÈS la réponse). " +
      "Épeler le mot à l'utilisateur avant d'appeler : une lettre fausse coûte une révision.",
    inputSchema: {
      mot: z.string().min(1).max(80).describe('le mot néerlandais, avec son article pour un nom'),
      traduction: z.string().min(1).max(200).describe('traduction française ; variantes séparées par « / »'),
      exemple: z.string().max(300).optional().describe('phrase d\'exemple en néerlandais contenant le mot'),
      astuce: z.string().max(200).optional().describe('indice montré pendant la question — ne révèle pas la réponse'),
      infos: z.string().max(300).optional().describe('infos révélées après la réponse : pluriel, temps du verbe, préposition…'),
    },
    annotations: WRITE,
  }, async ({ mot, traduction, exemple, astuce, infos }) => run(ctx, async user => {
    const data = await loadLearning(sb, user.id);
    const key = normalise(mot);
    const dup = data.words.find(w => normalise(w.source_word) === key);
    if (dup) return `« ${mot} » est déjà dans le vocabulaire — rien n'a été écrit :\n• ` + describeWord(srs, dup, data.progress[dup.id], data.log);
    const pendingDup = listDrafts().find(d => normalise(d.mot) === key);
    if (pendingDup) return `« ${mot} » est déjà en brouillon depuis le ${new Date(pendingDup.createdAt).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' })} — rien n'a été ajouté. ${plural(listDrafts().length, 'brouillon')} en attente sur ${localPage}.`;
    const noArticle = !articleOf(mot) ? ' Sans article : vérifier que ce n\'est pas un nom (de/het).' : '';
    if (draftMode) {
      const { pending } = addDraft({ mot, traduction, exemple, astuce, infos });
      return `Brouillon déposé : « ${mot} » → « ${traduction} »${exemple ? ` · exemple : « ${exemple} »` : ''}${astuce ? ` · astuce : ${astuce}` : ''}${infos ? ` · infos : ${infos}` : ''}.` +
        ` Il n'est PAS dans le vocabulaire : ${plural(pending, 'brouillon attend', 'brouillons attendent')} validation sur ${localPage} (sur le Mac).` + noArticle;
    }
    const id = await insertWord(sb, user.id, { mot, traduction, exemple, astuce, infos });
    return `Ajouté au vocabulaire : « ${mot} » → « ${traduction} »${exemple ? ` · exemple : « ${exemple} »` : ''}${astuce ? ` · astuce : ${astuce}` : ''}${infos ? ` · infos : ${infos}` : ''} (id ${id}). ` +
      `Il sortira comme mot nouveau dans une prochaine série. Vocabulaire : ${plural(data.words.length + 1, 'mot')}.` + noArticle;
  }));

  server.registerTool('lazypo_marquer_mot', {
    title: '« Étudier plus tard » : flagger ou retirer',
    description: QUAND +
      "Met un mot du vocabulaire dans « Étudier plus tard » (flag) ou l'en retire. Cherche le mot comme lazypo_mot ; refuse si plusieurs mots correspondent (et les liste) ou si aucun ne correspond. " +
      "Rend l'état après : le mot, flaggé ou non, et le nombre total de mots flaggés.",
    inputSchema: {
      texte: z.string().min(1).max(80).describe('le mot, en néerlandais de préférence'),
      etat: z.enum(['flag', 'retirer']).optional().describe('flag (défaut) ou retirer'),
    },
    annotations: WRITE,
  }, async ({ texte, etat }) => run(ctx, async user => {
    const data = await loadLearning(sb, user.id);
    const q = normalise(texte);
    let hits = findWords(data.words, texte, 5);
    const exact = hits.filter(w => normalise(w.source_word) === q);
    if (exact.length === 1) hits = exact;
    if (!hits.length) return `Aucun mot ne correspond à « ${texte} » : rien n'a été modifié.`;
    if (hits.length > 1) return `Plusieurs mots correspondent à « ${texte} », rien n'a été modifié. Préciser : ` + hits.map(w => `« ${w.source_word} » (${w.target_translation})`).join(', ') + '.';
    const w = hits[0];
    const on = (etat || 'flag') === 'flag';
    if (!!w.flagged_at === on) return `« ${w.source_word} » ${on ? 'est déjà' : 'n\'est pas'} dans « Étudier plus tard » : rien à changer.`;
    await setFlag(sb, user.id, w.id, on);
    const flagged = data.words.filter(x => x.flagged_at).length + (on ? 1 : -1);
    return `« ${w.source_word} » (${w.target_translation}) ${on ? 'mis dans' : 'retiré de'} « Étudier plus tard ». ${plural(flagged, 'mot flaggé', 'mots flaggés')} au total.`;
  }));
}
