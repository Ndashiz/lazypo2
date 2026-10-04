# Knowledge Quiz — Documentation

> Entraîneur de vocabulaire **EN→FR** et **NL→FR**, **grammaire néerlandaise** (23 chapitres) et verbes irréguliers, avec répétition espacée, gamification XP, et fil multijoueur.
>
> Le module est aussi **embarqué en iframe dans Jarvis** (`jarvis.ndashiz.be`) — voir §13.

---

## 1. Fichiers

| Fichier | Rôle |
|---------|------|
| `quiz.html` (~332 KB) | SPA complète : UI, logique, styles, état, **et les 23 chapitres de grammaire** (données inline). C'est le cœur de la feature. |
| `worker/src/worker.js` | Worker Cloudflare — sécurité/CSP. ⚠️ `/lazypo2/quiz.html` est **explicitement public** (voir §9). |
| `session.js` | Détection d'activité / déconnexion après 2h d'inactivité. |
| `demo.js` | Génération de données de démo. |
| `vocab_import_onboarding.js` | Flux de premier import avec détection de doublons. |
| `vocab_duplicate_modal.js` | UI de détection de doublons de vocabulaire. |
| `feedback_modal.js` | Soumission de feedback. |
| `auth.js` | Enregistrement / permissions des modules (quiz = module autorisé par défaut). |
| `sidebar.js` | Navigation (lien vers quiz.html). |
| `apis.js` | Registre des APIs (Supabase = backend principal). |

Dépendances chargées par `quiz.html` : `session.js`, `demo.js`, `vocab_import_onboarding.js`, `vocab_duplicate_modal.js`, lib `XLSX.js`, API Pravatar (avatars).

---

## 2. Vue d'ensemble

Le Knowledge Quiz est un entraîneur bilingue avec **5 onglets** dans `quiz.html` :

1. **🧠 Quiz** — **séance du jour** composée par le moteur d'apprentissage (parcours de chaque mot, re-questions, régulateur du nombre de nouveaux mots), ou **entraînement libre** réglé à la main (§4, §5).
2. **📚 Vocabulary** — gestion du vocabulaire perso + mots système, import/export Excel.
3. **📊 Progress** — stats, heatmap, graphiques, détail XP.
4. **🌍 Multi** — fil social, classement, Challenge Back, réactions.
5. **📖 Grammaire** — 23 chapitres de grammaire NL : théorie + exercices notés (voir §12).

Les **verbes irréguliers NL** ne sont plus un onglet : ils sont devenus le chapitre 23 du module Grammaire (`isVerbesModule` → `grShowVerbesEmbed()`), qui réutilise l'entraîneur de conjugaison existant.

Caractéristiques clés : répétition espacée à étapes (réception puis production), tableau de bord de pilotage (KPI), fil multijoueur avec Challenge Back, gamification XP + streak, classement all-time, import/export Excel, partage de vocabulaire entre utilisateurs, cours de grammaire noté.

---

## 3. Modèle de données

### Tables Supabase

**`vocabulary`** — le vocabulaire
- `id`, `user_id` (RLS : propre uniquement)
- `source_word` (anglais ou néerlandais), `target_translation` (français)
- `language_pair` ('EN→FR' ou 'NL→FR', legacy 'nl-fr')
- `example_sentence`, `tips` (optionnels) — `tips` est un indice montré **pendant** la question
- `extra_info` (optionnel, migration `vocab_extra_info.sql`) — infos complémentaires (temps du verbe, pluriel…) montrées **seulement à la correction** : feedback après réponse, Error Review, liste des mots ratés du résumé. Jamais pendant la question, ni au recto des fiches imprimées.
- `is_system` (bool) — marque le vocabulaire fourni par le système
- `flagged_at`, `flag_reason`, `flag_note` — flag d'un mot = **« Étudier plus tard »**, la seule catégorie du Flagger (Error Review, liste de vocabulaire ou pendant le test, voir §7bis). `flagged_at` non nul = le mot est dans la liste. `flag_reason` vaut toujours `to_study` : contrainte CHECK `vocabulary_flag_reason_single`, posée par `vocab_flag_single.sql`, qui a remappé les anciens motifs (`wrong_translation`, `typo`, `bad_example`, `other`) et les a sauvegardés dans `vocabulary_flag_backup`. `flag_note` n'est plus saisie : une note héritée reste lisible au survol du badge 🚩 et part au retrait du flag. Colonnes portées par la ligne elle-même : **un seul flag actif par mot, pas d'historique**.
- `suspended_at` (migration `quiz_srs_v2.sql`) — **plus lue** : elle servait à l'atelier sangsues, retiré en octobre 2026. Un mot suspendu à l'époque est revenu dans les séries.
- RLS `own_vocabulary` — couvre déjà ces colonnes, pas de policy supplémentaire

**`quiz_progress`** — état de chaque mot dans le moteur (§5)
- `word_id`, `correct`, `attempts`, `last_tested`
- `ease_factor` (défaut 2.5, entre 1.3 et 2.5), `interval_days` (défaut 1)
- `recent` (jsonb, 10 dernières réponses 1/0 — fenêtre glissante de maîtrise, migrations `quiz_progress_recent.sql` ou `quiz_srs_v2.sql`)
- `stage` (`learn` | `recv` | `prod` ; null + `attempts = 0` = nouveau), `lapses` (oublis cumulés), `first_tested` (première question posée) — migration `quiz_srs_v2.sql`, qui initialise aussi les mots déjà travaillés (`stage = 'recv'`, `lapses = attempts − correct`) et ramène à 30 jours les intervalles gonflés par l'ancien moteur
- unique `(user_id, word_id)`, RLS `own_progress`

**`quiz_answers`** — journal des réponses (migration `quiz_srs_v2.sql`)
- Une ligne par réponse, re-questions comprises : `word_id`, `session_key`, `mode` (`daily` | `free` | `challenge` ; `atelier` sur les lignes d'avant son retrait), `answered_at`, `direction`, `stage` (avant la réponse), `grade` (1 raté · 2 difficile · 3 bien · 4 facile ; null pour une re-question), `correct`, `close_match`, `first_key_ms`, `total_ms`, `is_new`, `is_relearn`, `is_leech`, `was_due`, `elapsed_days`, `interval_before`, `interval_after`
- Source des KPI et du régulateur (§5). RLS `own_answers`, index `(user_id, answered_at desc)`

**`quiz_settings`** — réglages du moteur (migration `quiz_srs_v2.sql`)
- `user_id` (PK), `new_per_day` (budget quotidien de nouveaux mots, défaut 8), `adjusted_on` (date locale du dernier passage du régulateur), `last_reason`. RLS `own_quiz_settings`

**`quiz_sessions`** — fil social / multi
- `display_name`, `avatar_url`, `score`, `total`, `duration_sec`
- `mode` ('vocab' | 'verbes' | **'grammar'**), `lang`, `direction` ('forward' | 'reverse' | 'auto')
- `theme` — pour les sessions grammaire, l'id du chapitre (`lang` porte la même valeur)
- `words` (jsonb) — snapshot des mots joués → permet le Challenge Back **cross-user** (les IDs diffèrent d'un user à l'autre)
- `word_ids` (jsonb, déprécié au profit de `words`)

**`quiz_session_comments`** — commentaires sous chaque session (sert aussi à publier le résultat d'un Challenge Back).

**`quiz_session_reactions`** — réactions emoji `fire` / `muscle` / `clap`, clé `(session_id, user_id, type)`.

**`user_xp`** — XP & streak
- `total_xp` (cumul, jamais décrémenté), `current_streak_days`, `last_active_date`
- `last_reconciled_date`, `today_new_words`, `awarded_streak_milestones` (int[]), `mastered_word_ids` (uuid[])
- `mastered_module_ids` (text[]) — chapitres de grammaire déjà récompensés (anti double-crédit)

**`grammar_progress`** — progression par chapitre de grammaire
- clé `(user_id, module_id)` (upsert `onConflict: 'user_id,module_id'`)
- `attempts`, `best_score`, `last_tested`
- `scores_history` (int[]) — **10 derniers scores en %**, fenêtre glissante
- `status` — `'todo'` | `'in_progress'` | `'mastered'` ; **maîtrisé dès que la moyenne des scores de la fenêtre ≥ 80 %**

**`xp_daily_log`** — historique XP par jour
- `(user_id, date)`, `xp_earned`, `breakdown` (jsonb par règle) → alimente la heatmap.

**`vocab_shares`** — partage de vocabulaire entre utilisateurs
- `sender_id`, `recipient_id`, `payload` (jsonb `{v, words:[{s,t,l,e?,p?}]}`), `status` ('pending'|'accepted'|'declined')

**`profiles`** — `username`, `avatar_url` (affichage classement & fil).

### localStorage

| Clé | Contenu |
|-----|---------|
| `lazypo_quiz_log` | Array `{date, words, correct, durationSec, kind}` — calcul de streak local (fallback 28 j si `xp_daily_log` indispo) ; la dernière séance ajuste la suivante (§5). |
| `lazypo_verbs_progress` | Progression verbes NL `{verbId: {correct, attempts, …}}`. |
| `lazypo_new_intro` | `{date (locale), count}` — nouveaux mots introduits aujourd'hui sur cet appareil. Repli seulement : la base (`first_tested`, `quiz_answers`) compte tous les appareils. |
| `lazypo_srs_settings` | Copie locale de `quiz_settings` — repli si la table n'existe pas. |
| `lazypo_quiz_setup_mode` | `daily` ou `free` : dernier type de séance choisi. |
| `lazypo:lastActivity` | Timestamp d'activité (timeout de session). |

---

## 4. Sources des questions

1. **Vocabulaire système** (`is_system: true`) — 1000+ mots néerlandais (`dutch_vocabulary.sql`), catégories : nombres, jours, mois, saisons, couleurs, corps, famille, nourriture, animaux, nature, maison, vêtements, transport, école/travail, santé, sports, technologie. Lisible par tous via RLS.
2. **Vocabulaire utilisateur** (`is_system: false`) — ajout manuel EN/NL → FR, détection de doublon sur `(source_word, language_pair)`.
3. **Séance du jour** (`srsComposeDaily()`, §5) — composée par le moteur : révisions par risque d'oubli, part réservée aux nouveaux mots, sangsues plafonnées, direction selon l'étape du mot.
4. **Entraînement libre** (`buildQuizQueue()`) — les réglages à la main : paire de langue, système/user, « Needs practice », « Étudier plus tard », plage de numéros, direction forcée ou auto (= étape du mot), phrases à trous. Ordre des groupes : (flaggés si « En premier ») → dus (risque d'oubli ; les plus fragiles d'abord avec « Needs practice ») → nouveaux (tes ajouts récents d'abord, 15 par jour au plus) → vus non dus.

> **Pas d'intégration IA/LLM.** Les questions viennent du vocabulaire pré-chargé (SQL) et des traductions saisies par l'utilisateur. Aucune génération ni correction par LLM.

---

## 5. Scoring, répétition espacée & XP

### Moteur d'apprentissage v2 — octobre 2026

Né de l'audit du 4 octobre 2026 : les nouveaux mots ne recevaient que les places restantes après
toutes les révisions dues (0 nouveau mot par série de 5 à 200 questions), les échecs revenaient le
lendemain sans avoir été réappris, et les révisions anticipées gonflaient les intervalles (jusqu'à
76 488 jours). Toute la logique de décision vit dans le bloc **`SRS-PURE-BEGIN` … `SRS-PURE-END`**
de `quiz.html` : des fonctions pures, sans DOM ni réseau, qu'on teste hors navigateur en extrayant
le bloc (`new Function(code + 'return { srsNext, … }')()` sous Node).

**Parcours d'un mot** (`quiz_progress.stage`, `srsStage()`) :

| Étape | Direction | Sortie |
|---|---|---|
| `new` (jamais posé) | NL → FR | 1re réponse : `learn` à J+1 (« Facile » d'emblée : `recv` à 3 j). Rater un mot jamais vu n'est **pas** un oubli. |
| `learn` | NL → FR | Rappel à J+1 réussi → `recv` à 3 j (4 j si Facile) |
| `recv` (réception) | NL → FR | Quand l'intervalle atteint 7 j → `prod`, à un tiers de l'intervalle |
| `prod` (production) | FR → NL ; phrase à trou une fois sur deux pour un mot acquis qui a un exemple | Acquis à 21 j ou plus |

Les lignes d'avant la v2 (sans `stage`) sont lues comme `recv` : l'ancien moteur mélangeait les deux sens.

**Note automatique, sans clic de plus** (`srsGrade()`) : **Raté** (faux, « Skip », chrono écoulé) ·
**Difficile** (accepté « proche » sur une faute de frappe, article néerlandais absent ou faux, ou plus
de 8 s avant la première frappe) · **Bien** · **Facile** (exact, première frappe en moins de 2 s). Le
temps avant la première frappe mesure le rappel, pas la vitesse de frappe ; il est ignoré si la page
a été masquée pendant la question. La note s'affiche avec la correction.

**Intervalles** (`srsNext()`) : Raté → 1 j, facilité −0,2, un oubli de plus · Difficile → × 1,2,
facilité −0,15 · Bien → × facilité, qui remonte de 0,15 tant qu'elle est sous 2,5 · Facile → × facilité
× 1,3. Une révision réussie à l'heure fait toujours avancer l'intervalle d'au moins un jour (fini le
« 1 × 1,4 arrondi = 1 » des facilités basses). **Révision en avance** : on multiplie le temps
réellement écoulé, jamais moins que l'intervalle actuel — un mot à 8 jours revu le lendemain reste à
8 jours au lieu de passer à 20.

**Re-questions** (`queueRelearn()`) : un mot raté ou passé revient 3 à 5 questions plus loin, un mot
découvert 2 à 3 plus loin, jusqu'à une réussite (3 fois au plus par séance). Hors score, sans effet
sur l'espacement — seule la note du premier essai compte — mais journalisées (`is_relearn`). Pas de
re-question en Challenge Back : un défi reste un test.

**Sangsue** (`srsIsLeech()`) : 4 oublis ou plus (`lapses`) et moins de 50 % de réussite (fenêtre
`recent` si dispo) — un mot redevenu solide en sort de lui-même par la fenêtre glissante.
Plafonnées à 10 % de chaque séance du jour (5 % quand elles dépassent 15 % de l'effort).

> Un **atelier sangsues** (fiche + phrase à écrire + trois rappels + suspension) a existé quelques
> heures en octobre 2026, puis a été retiré à la demande de Simon. Les sangsues restent
> simplement mêlées aux séances, plafonnées.

**Séance du jour** (`srsComposeDaily()`) : budget de nouveaux mots **réservé** (N par jour moins ceux
déjà découverts aujourd'hui, tous appareils), à raison d'un toutes les 3 à 4 questions — au lieu des
places restantes ; nouveaux mots dans l'ordre `srsNewWordOrder()` (deux sur trois parmi tes ajouts
les plus récents, un sur trois dans ton stock le plus ancien, la liste système en dernier) ;
révisions dues par **risque d'oubli** (temps écoulé ÷ intervalle), plus par taux d'échec ; **aucun
mot non dû** en remplissage : sans révisions ni budget, la séance est simplement plus courte. Une
dernière série sous 70 % allège la suivante (moitié moins de nouveaux, 1 sangsue), au-dessus de
92 % elle prend un tiers de nouveaux.

### Pilotage : KPI et régulateur

**Régulateur** (`srsRegulate()`, une fois par jour local à l'ouverture, `runSrsRegulator()`) — ajuste N
sur les 7 derniers jours du journal, stocké dans `quiz_settings` :

| Signal | Seuil | Action |
|---|---|---|
| Rétention à l'échéance (1er essai des révisions dues) | ≥ 90 % et retard < 1 jour | N + 2 (max 20) |
| | 80 à 90 % | N inchangé |
| Rétention ou retard | < 80 %, ou retard > 2 jours | N − 3 (min 3) |
| Nouveaux mots retrouvés au rappel | < 60 % | N − 1 |

Sans 30 révisions dues dans le journal des 7 derniers jours, rien ne bouge (N de départ : 8). N ne
tombe jamais à zéro : un peu de nouveauté chaque jour entretient la motivation. La raison du dernier
ajustement s'affiche dans le panneau du jour et dans l'onglet Progress.

**Tableau de bord** (onglet Progress, `renderKpiPanel()` sur `srsKpis()`) — chaque indicateur avec sa
cible et un statut (dans la cible / à surveiller / hors cible / pas encore mesurable) : mots acquis
(indicateur principal, + cette semaine), nouveaux mots par jour, rétention à l'échéance (avec l'écart
sur la semaine précédente), retard en jours de travail, part de l'effort sur les sangsues, nouveaux
mots retrouvés au rappel, tes mots en attente de 1re question (âge médian), écart réception /
production, temps avant la 1re frappe. Plus le parcours : nouveaux · apprentissage · réception ·
production · acquis.

**Sans la migration** `quiz_srs_v2.sql`, tout fonctionne en mode dégradé : l'état v2 vit en mémoire
pendant la séance (`progressV2Missing`), le compteur de nouveaux mots retombe sur le localStorage, le
journal reste local (`answersLogMissing`) et le tableau de bord le signale.

**Fenêtre glissante** : colonne `quiz_progress.recent` (jsonb, 10 dernières réponses 1/0). La maîtrise (≥80 %), les mots fragiles (<60 %) et les sangsues se calculent sur cette fenêtre dès ≥3 réponses (`wordRate()` / `srsRate()`), sinon fallback ratio lifetime.

### Correction des réponses — `checkAnswer()`
- Exact (insensible à la casse) → ✓ Correct. Alternatives séparées par `" / "`.
- **« Accepté »** : accents ignorés + article initial ignoré (le/la/les/l'/un/une/des · de/het/een · the/a/an) via `normalizeAnswer()` — la forme exacte est rappelée dans le feedback.
- **« Proche »** : 1 typo (distance Damerau-Levenshtein = 1, transpositions incluses : « chein » → « chien »).
- **Article néerlandais en production** (`articleIssueFor()`) : en FR → NL, « fiets » ou « het fiets » pour « de fiets » est accepté mais noté **Difficile**, avec « L'article compte : "de fiets" ». En NL → FR, l'article français reste facultatif.
- La note (Raté / Difficile / Bien / Facile) s'affiche dans la correction ; pour un mot découvert, une erreur ou un « Skip », la **fiche complète** suit (mot, traduction, phrase, astuce, infos).

### Phrases à trous (cloze) — `buildClozeItem()`
- Séance du jour : un mot **acquis** (production à 21 j ou plus) qui a une phrase d'exemple passe une fois sur deux en phrase à trou (`srsDirection()`).
- Entraînement libre : option « 🧩 Mix (~1/3) » (`#cloze-pills`, défaut : off).
- Quand la phrase d'exemple contient le mot source, ~1 question sur 3 devient un texte à trou : la phrase avec `_____`, la traduction affichée en indice, réponse = la forme réelle dans la phrase.
- La review des erreurs affiche la phrase à trou et le mot attendu (direction `cloze`).

### Règles XP (réconciliation 1×/jour UTC — `runXpReconciliation()`)

La réconciliation tourne une fois par jour, **après la première activité** (une séance postée dans
`quiz_sessions`). Jusqu'en octobre 2026, celle lancée au chargement de la page marquait la journée
comme faite avant toute séance : les règles liées aux séances, et la série de jours, ne pouvaient
presque jamais tomber.

| Règle | XP | Déclencheur |
|-------|----|-------------|
| Paliers de streak | 30 × (jour/5) | Tous les 5 jours consécutifs (5→30, 10→60…) |
| 5 mots/jour | 25 | ≥5 nouveaux mots ajoutés aujourd'hui |
| Séance du jour | 15 | Une séance du jour d'au moins 10 questions aujourd'hui (`quiz_sessions.lang = 'daily'`) |
| Mot acquis | 10 / mot (cap 50/j) | Production à 21 j ou plus, crédité une fois (`mastered_word_ids`) |
| Rétention ≥ 85 % | 10 | Rétention à l'échéance ≥ 85 % sur 7 jours (30 révisions dues au moins) |
| Retard soldé | 20 | Actif aujourd'hui et plus aucune révision due |
| Diversité modes | 10 | Joué 'vocab' ET ('verbes' OU **'grammar'**) aujourd'hui |
| 1er commentaire social | 5 | 1er commentaire sur la session d'un autre |

> **Réalignées en octobre 2026** sur l'apprentissage : quiz parfait, quiz de 20+ questions, maîtrise au
> taux, récupération et diversité des directions ne rapportent plus rien — ils récompensaient les
> séries longues ou faciles (et la récupération se re-créditait chaque jour). Leurs libellés restent
> dans `showXpBreakdown()` pour l'historique.
| **Maîtrise d'un chapitre** | **40 / chapitre** | Chapitre de grammaire passé en `mastered` — **hors réconciliation**, crédité immédiatement (voir ci-dessous) |

Sources de vérité : `user_xp.total_xp` (cumul) et `xp_daily_log` (détail par jour).

> ⚠️ La maîtrise d'un chapitre de grammaire est le **seul XP attribué en direct** (`grAwardMasteryXp()` : `UPDATE user_xp` immédiat), pas via `runXpReconciliation()`. Il n'apparaît donc **pas** dans `xp_daily_log` et ne remonte pas dans la heatmap ni dans le détail XP par jour — seulement dans `total_xp`. L'anti-double-crédit repose sur `user_xp.mastered_module_ids`.

### Classement
- All-time par `total_xp`, départage par % moyen (`totalScore/totalPossible`).
- Top 5 affiché ; user courant affiché à part si hors top 5.

### Streak
- `user_xp.current_streak_days` ; reset si pas de quiz le jour même / consécutif. Fallback `computeStreak()` depuis `lazypo_quiz_log`.

---

## 6. Multijoueur & Challenge Back

### Fil social
- Paginé (20 sessions/page, lazy load), tri par date.
- Affiche nom, avatar, score/%, mode, ancienneté, nb commentaires.
- Réactions 🔥 / 💪 / 👏, commentaires imbriqués.
- Bouton Challenge Back visible si le snapshot `words` existe.

### Flux Challenge Back
1. Le quiz est rempli avec les **mots exacts** joués par l'autre user (cross-user safe via `words`).
2. L'utilisateur rejoue le même défi.
3. Résultats côte à côte « Moi » vs joueur d'origine → verdict Victoire 🏆 / Défaite / Égalité.
4. Option : publier le résultat en commentaire sur la session d'origine.
5. Option : ajouter les mots joués à son propre vocabulaire.

Implémentation : `launchChallengeQuiz(wordSnapshots, wordIdsFallback, originalMeta)` règle `challengeContext`. Fallback (sessions pré-snapshot) : recherche des IDs dans le vocab courant. La session de challenge n'est pas auto-postée (publication manuelle).

### Démo (admin only)
- `loadMultiDemoFeed()` génère 100 fausses sessions (noms, scores, réactions, commentaires). Challenge Back désactivé en démo.

---

## 7. Flux UI/UX

**Setup quiz** : deux onglets en tête (`#daily-panel` / `#free-panel`, choix mémorisé dans `lazypo_quiz_setup_mode`).

- **📅 Séance du jour** (défaut) : seule la longueur se choisit (10 / 20 / 50 / 100). Quand il n'y a pas assez de révisions dues, la séance est plus courte et le panneau le dit — elle ne se complète jamais avec des mots pas encore dus ; le volume en plus se fait en Entraînement libre. Le panneau annonce ce que la séance va servir (« 20 questions — 5 nouveaux mots, 13 révisions, 2 sangsues »), les révisions dues, le budget du jour et la raison du dernier ajustement du régulateur (`renderDailyPanel()`, appelé par `updateAvailNote()`).
- **🎛️ Entraînement libre** : les réglages ci-dessous.

Entraînement libre : paire de langue → direction → filtres (système, ratés/fragiles) → **plage de mots** → nombre de questions (5/10/20/50/100/200/All) → Start. La note sous les boutons annonce la taille réelle de la série quand le plafond de nouveaux mots du jour la raccourcit (« cette session : N questions ») ; Start est désactivé si elle tombe à 0.

> **Plage de mots** — deux champs `du n° … au n° …` qui restreignent la session à un intervalle de
> numéros permanents (« je révise du mot 1 au 250 »). Les deux bornes sont facultatives : vide =
> pas de borne, `Tout` remet à zéro. Une plage inversée n'est pas corrigée en douce — elle affiche
> « plage vide » et `Start` se désactive tout seul (0 mot disponible). Le filtre s'applique dans
> `filterVocabForQuiz()`, donc il vaut aussi pour la file réellement tirée par `buildQuizQueue()`.
> `loadVocab()` appelle `computeVocabNumbers()` pour que les numéros existent même si l'onglet
> Vocabulary n'a jamais été ouvert.

**Quiz actif** : timer 30 s par question, exemple + tip optionnels, saisie + Enter/Check, feedback ✅/❌ avec la note, compteur de streak.

- **Drapeaux** (SVG inline, `flagHtml()` — sous Windows les emoji drapeaux s'affichent en lettres) : badge de direction « 🇳🇱 NL → 🇫🇷 FR », drapeau de la langue attendue dans le champ de réponse, et texte d'aide « Your answer in Dutch… ». `langPair()` lit aussi l'ancien `nl-fr` de la liste système (avant : « nl-fr → undefined »).
- **« Skip » et chrono écoulé montrent la réponse** et la fiche, puis Next — on n'avance plus à l'aveugle, et ces mots vont dans l'Error Review.
- **Re-questions** (§5) : libellé « ↻ Re-question », compteur « 7 / 20 · ↻ » — la série affichée ne compte que les questions prévues.
- **« Précédent » en lecture seule** (`renderAnsweredState()`) : on revoit la question d'avant et sa correction ; plus jamais de second enregistrement dans `quiz_progress`.

> **Le compte à rebours suit une échéance, il n'accumule pas de ticks.** Un `secs--` par tick de
> `setInterval` est faux dès que le navigateur régule les timers — onglet en arrière-plan, iframe
> masquée côté Jarvis, machine en veille : les callbacks en attente sont rejoués en rafale au
> retour et le compteur s'effondre d'un coup (23 → 5 = 18 ticks d'affilée). `tickQuizTimer()`
> recalcule `Math.ceil((quizTimerDeadline - Date.now()) / 1000)` toutes les 250 ms : une rafale
> recalcule simplement plusieurs fois la même valeur.
>
> Le compte est **gelé pendant que la page est masquée** (`visibilitychange` → `quizHiddenAt`), et
> le temps passé masqué est rendu à l'échéance. Sans ça, l'échéance en temps réel ferait expirer la
> question dès le retour sur l'onglet : regarder ailleurs coûterait la question.

**Fin de session** : Review des erreurs — « Skip » et chrono écoulé compris — (si présentes) → résumé (score, %, temps, badge streak, nouveaux mots découverts, re-questions) → panneau d'ajout (si Challenge Back) → auto-post au fil (sauf mode Challenge ; une séance du jour est postée avec `lang = 'daily'`). La progression n'est rechargée qu'après les écritures encore en vol (`pendingProgressWrites`).

> **Arrêter une série en cours** — bouton **⏹ Stop** en bas à droite de `#quiz-active`, à l'écart
> de Check / Skip. Pour une série de 200 qu'il faut interrompre : la session se termine sur les
> questions **déjà répondues**, avec la même fin qu'une série complète (Error Review, résumé, post
> au fil, XP). La question affichée sans réponse **ne compte pas** : rien n'est écrit pour elle, le
> SRS ne bouge pas.
>
> - **Second clic pour confirmer** (`⏹ Confirm: see results`), dans les 5 s, sinon le bouton se
>   réarme. Jamais de `confirm()` : la page tourne en iframe chez Jarvis.
> - Le résumé le dit : « ⏹ Stopped after 37 of 200 questions — the other 163 weren't counted. »
>   Sans cette ligne, « 30 / 37 » laisserait croire à une série de 37. Arrêtée après la dernière
>   réponse, la série est complète et la ligne n'apparaît pas.
> - Aucune réponse au moment de l'arrêt : retour au setup avec un toast, rien n'est posté au fil.
> - `stopQuiz()` pose `sessionStopInfo = { answered, planned }` puis appelle `endSession()` ;
>   `resetSessionStop()` le remet à `null` et désarme le bouton au départ de chaque session
>   (setup et Challenge Back).

**Vocabulary** : formulaire d'ajout rapide, import/export Excel, actions bulk, table triable **au clic sur n'importe quel en-tête**, filtres.

> **Tri au clic** (`sortCol` / `sortDir`, `SORT_ACCESSORS`, `sortVocabList()`) — comme dans Excel :
> un clic trie, un second inverse le sens. Les colonnes numériques (`#`, taux) partent en
> décroissant, les colonnes texte en alphabétique. **Les cellules vides restent toujours en bas**,
> quel que soit le sens : inverser un tri pour faire remonter 400 tirets ne sert personne. Un mot
> sans tentative n'a pas un taux de 0 % mais *pas de taux* — il compte comme vide.
> L'ancien `<select id="vocab-sort">` était en `display:none` et sans handler : les en-têtes
> portaient déjà `class="sortable"` mais ne réagissaient à rien. Les deux ont été remplacés.

> **Colonne `#`** — numéro **permanent** du mot, calculé par `computeVocabNumbers()` comme son
> rang de création (le plus ancien = 1), pas comme sa position dans la liste affichée. Trier,
> filtrer ou ajouter un mot ne renumérote rien : un nouveau mot prend le numéro suivant. C'est
> ce qui permet de noter où on s'est arrêté et de le retrouver. Départage des ex æquo par `id`,
> sinon un import en masse (même `created_at` sur 1000 lignes) donnerait un ordre différent à
> chaque requête. Supprimer un mot décale les suivants — seul cas où un numéro bouge.

> **Imprimer / Étudier** (`#print-panel`, `runPrint()`) — le bouton ouvre un panneau au lieu
> d'imprimer sec : **format**, **plage de n°**, **contenu**. Chaque sortie porte toujours le mot,
> la traduction et la phrase de contexte (cochable), plus l'astuce et la langue en option.
>
> | Format | Rendu |
> |---|---|
> | 📄 Liste d'étude | 2 colonnes, une entrée = mot / traduction / phrase, jamais coupée entre deux pages. |
> | 🃏 Fiches à découper | Grille 2 × 5, recto = mot + phrase, verso = traduction. |
> | ✍️ Test à trous | Mot + phrase, colonne traduction vide à remplir, **corrigé sur une page à part**. |
>
> On imprime **ce que la liste affiche** — mêmes filtres (langue, niveau, flag, recherche), même
> tri — restreint à la plage de numéros permanents. Seule exception : trié par `#`, la feuille
> part du n° 1 (un support papier se lit dans ce sens ; l'écran montre les derniers ajouts en
> premier). Le compteur du panneau suit les filtres en direct, via `renderVocab()`.
>
> Deux contraintes d'impression, apprises à la dure :
> - `#print-area` est le seul enfant de `<body>` laissé visible, en `display:none` pour les
>   autres — pas en `visibility:hidden` : un élément invisible occupe encore ses pages, et un
>   `position:fixed` se fait clipper à la première feuille par Chrome.
> - Le format fiches **n'a pas de titre de document**. Il décalerait le recto de la première
>   feuille vers le bas alors que son verso démarre en haut : tout ce qu'on découpe ressort de
>   travers. Chaque page porte la même étiquette d'une ligne, et le verso inverse chaque paire
>   de fiches (miroir), sinon chaque carte découpée porte la traduction de sa voisine.

**Progress** : carte streak, stats (mots totaux, maîtrisés, taux), donut système/user, barres EN↔NL, heatmap 28 jours.

**Multi** : classement (top 5 + user), fil scroll infini, réactions, Challenge Back, commentaires.

---

## 7bis. Corriger un mot, ou le flagger pour l'étudier plus tard

Deux gestes sur l'écran Error Review (`#quiz-review`), pour deux besoins distincts : **corriger**
un mot dont la fiche est fausse, et **flagger** un mot qu'on trouve difficile pour l'ajouter à
**« Étudier plus tard »**, la seule catégorie du Flagger. Corriger n'existe que là ; flagger est
aussi possible **pendant le test** et **depuis la liste de vocabulaire**, toujours en un clic.

| Geste | Bouton | Écrit |
|---|---|---|
| Corriger le mot | ✏️ Fix this word | `source_word`, `target_translation`, `example_sentence`, `tips`, `extra_info` |
| Supprimer le mot | ✏️ Fix this word → 🗑️ Delete word | `DELETE` sur `vocabulary` (+ `quiz_progress` en cascade) |
| Ajouter à « Étudier plus tard », ou l'en retirer | 🚩 Flag / 🚩 Flagged | `flagged_at`, `flag_reason = 'to_study'` via `flagPatch(on)` |

### Ce qui ne bouge pas

- **Le score n'est jamais recalculé.** Corriger un mot met à jour le vocabulaire pour les
  prochaines sessions ; la réponse reste comptée fausse et `quiz_progress` n'est pas retouché. Le
  toast le dit explicitement.
- **Le flag ne touche ni au score ni au SRS**, et n'exclut pas le mot du tirage.
- `reviewIndex` ne bouge pas : le panneau de correction se déplie **en place**, sous la comparaison
  ❌/✅, et le 🚩 bascule sans rien ouvrir. Jamais de modale — l'écran tourne en iframe chez Jarvis, une modale centrée sur le
  viewport se placerait de travers.

### Contraintes d'implémentation

- **`saveWordPatch(id, patch)`, pas `updateWord()`** : cette dernière enchaîne `loadVocab()`
  (repagination complète du vocabulaire) puis `renderVocab()` sur un onglet caché. En pleine
  review c'est un aller-retour réseau inutile. `saveWordPatch` pose `vocabDirty = true` et
  `flushVocabDirty()` recharge **une seule fois**, plus tard : au retour sur l'onglet vocabulaire
  ou dans `showSummary()`.
- **Mutation en place**, jamais de réassignation : `vocab[]`, `quizQueue[].word`,
  `reviewQueue[].word` et `sessionAnswers[].word` pointent vers le même objet. Un `Object.assign`
  les met tous à jour d'un coup ; réassigner en laisserait la moitié périmés.
- **`.select()` obligatoire après l'`update`** : sans lui, un refus RLS (0 ligne, 0 erreur)
  ressemble à un succès. Le garde 0-ligne renvoie le toast
  « Modification bloquée — vérifie les RLS policies Supabase ».
- **`word.id` peut être `null`** (Challenge Back : snapshot cross-user). Les deux boutons sont
  alors masqués, pas désactivés.
- **Clavier** : `Enter` enregistre, `Escape` annule. `stopPropagation()` sur les champs pour qu'un
  `Enter` en pleine correction ne puisse jamais faire avancer le quiz.
- **Mode `cloze`** : la phrase à trou est figée sur la réponse au moment du tirage. Après édition
  de l'exemple elle est reconstruite via `buildClozeItem()`, sinon l'écran afficherait l'ancienne.
- **Migration pas encore passée** : l'erreur Supabase sur colonne inconnue produit le toast
  « Flag indisponible — la migration SQL n'est pas encore passée », pas une exception.

### Supprimer le mot depuis la correction

Pour le mot qui n'a rien à faire dans la liste (doublon, faute d'import, mot inutile), le panneau
**Fix this word** porte un bouton **🗑️ Delete word**, à droite, à l'écart de `Save`.

- **Confirmation en ligne**, jamais `confirm()` : un encadré rouge nomme le mot et prévient que sa
  progression part avec lui. Le focus va sur **Keep it**, l'option sûre — un `Entrée` réflexe
  garde le mot. `Échap` referme la confirmation sans fermer la correction. `Entrée` dans un champ
  reste `Save`, jamais `Delete`.
- **`reviewCommitDelete()`** : `.delete().eq('id').eq('user_id').select('id')`. Même garde 0-ligne
  que pour l'`update` — sans `.select()`, un refus RLS ressemblerait à un succès. Le bouton est
  désactivé pendant la requête : un double clic enverrait deux `DELETE`, et le second (0 ligne)
  afficherait un faux refus RLS.
- **Le mot reste dans la review.** Il fait partie de la session et le score n'est pas recalculé :
  le retirer de `reviewQueue` changerait le compteur `1 / 3` en plein milieu. L'item est marqué
  « Deleted from your vocabulary », les outils ✏️ / 🚩 disparaissent, `Previous` / `Next`
  fonctionnent comme avant.
- **Aucun rechargement pendant la review** : `vocab` est filtré, `progress[id]` retiré,
  `computeVocabNumbers()` recalculé (les mots créés après lui perdent un rang), `vocabDirty` posé.
  `quiz_progress` part en cascade côté base (`on delete cascade`).
- `reviewDeletedIds` est un `Set` d'ids plutôt qu'un marqueur sur l'objet mot : les lignes Supabase
  restent des lignes, et un id supprimé ne revient jamais — pas besoin de le vider entre sessions.

### Retrouver un mot flaggé

Un badge 🚩 s'affiche sur la ligne dans l'onglet Vocabulary (titre « Étudier plus tard »), et la
pilule **🚩 Étudier plus tard** filtre la liste — l'impression suit le même filtre. Sans ça le flag
serait un trou noir : posé une fois, jamais revu.

Dans la review, le bouton affiche **🚩 Flagged** quand le mot est dans la liste ; un clic l'en
retire, un autre l'y remet. Plus de panneau, de motif ni de note : il n'y a rien à confirmer, et
le geste se défait d'un clic.

### Travailler les mots flaggés — deux options, aucune imposée

Flagger un mot, c'est dire **« ce mot, je dois l'étudier »**. Mais c'est l'utilisateur qui décide
quand ça pèse sur une session — **par défaut, un mot flaggé est un mot comme les autres** et suit la
répétition espacée.

- Option **🚩 Étudier plus tard** dans le setup : `🔀 Mélangés aux autres` (défaut) ou `⏫ En premier`
  (`flaggedFirst`). Avec « En premier », `buildQuizQueue()` place les flaggés dans un bucket
  prioritaire, avant les mots dus : flaggé → dû → nouveau (plafonné) → déjà vu. Ils échappent
  alors au plafond `NEW_WORDS_PER_DAY` — c'est un choix explicite, pas une découverte subie. Tri
  par flag le plus récent d'abord, pour survivre au `slice(0, n)`.
- Filtre **🚩 Étudier plus tard** dans « Words to include » (`filter === 'flagged'`) pour une session
  composée uniquement de mots flaggés. L'option de priorité y est sans effet, et sa note le dit.

L'option n'apparaît que si **au moins un mot est flaggé** dans tout le vocabulaire (pas seulement
dans la sélection, pour qu'elle ne clignote pas au gré des filtres). Comme les autres options du
setup, elle n'est pas mémorisée : elle revient sur « Mélangés » à chaque chargement.

> Historique : jusqu'à mi-septembre 2026 les flaggés passaient **toujours** en premier. Avec 31
> mots flaggés, chaque session de 10 questions n'était plus faite que de mots flaggés — l'option a
> remplacé ce comportement imposé.

La bannière du setup n'annonce `🚩 N mots dans « Étudier plus tard » — ils passeront en premier` que si l'option est
active ; la ligne `🔔 N mots à réviser` ne dit « ensuite » que dans ce cas. Le flag n'est
**jamais retiré automatiquement** après une bonne réponse — c'est à l'utilisateur de décider qu'un
mot est acquis.

### Flagger pendant le test

Bouton **🚩 Flag** dans la ligne streak / timer de `#quiz-active`, visible avant **et** après la
réponse (on flagge souvent en lisant la correction). Un clic ajoute le mot à « Étudier plus tard »
sans quitter la question (`flagPatch(true)` : `flagged_at` + `flag_reason: 'to_study'`).

- **Trois états** (`syncQuizFlagBtn()`, appelée par `showQuestion()`) : `🚩 Flag` ;
  `🚩 Flagged` (marqué dans ce test) ; `🚩 Already flagged`, en pointillé, pour un mot flaggé
  **avant** le test — sinon, avec « En premier » ou le filtre 🚩 Étudier plus tard, toute la session
  s'afficherait comme flaggée pendant le test et la review ne ferait plus le tri.
- **Deux Sets** remis à zéro au départ de chaque session (`resetSessionFlags()`, y compris
  Challenge Back) : `sessionFlaggedIds` (marqués dans ce test → review + résumé) et
  `sessionFlagWrote` (dont ce test a lui-même posé le flag en base). Marquer un mot déjà flaggé
  n'écrit rien ; démarquer n'efface que ce que le test a posé — un flag antérieur au test reste
  en place.
- **Optimiste** : le Set change au clic, l'écriture (`saveWordPatch`) suit, et un échec remet
  l'état d'avant. Sans ça, un timer qui expire pendant l'écriture fermerait la session sans le mot.
  `sessionFlagBusy` ignore un second clic sur le même mot tant que l'écriture court.
- Après le clic, le focus revient au champ de réponse (ou à `Next`) : on continue de taper.
  Le timer ne s'arrête pas, le score et le SRS ne bougent pas.
- Mot sans `id` (snapshot cross-user) : bouton masqué, comme les outils de la review.

**Review** : `endSession()` y envoie les erreurs **et** les mots de `sessionFlaggedIds` — même
répondus juste ou passés —, dans l'ordre de la session. Le titre suit le contenu (`🔍 Error Review`,
`🚩 Flagged words` ou `🔍 Errors & 🚩 flagged words`), une pastille « 🚩 Flagged during the test »
marque ces mots, et une bonne réponse s'affiche en vert (`✅ Your answer`) au lieu d'être barrée.

**Résumé** : section **🚩 Flagged during this test**, au-dessus de « Words to review » — mot et
traduction. N'y restent que les mots **toujours** flaggés : un flag retiré ou un mot
supprimé pendant la review en sort.

### Flagger depuis la liste de vocabulaire

Le même geste est disponible hors session, via le bouton 🚩 de la colonne Actions : un clic ajoute
le mot à « Étudier plus tard », un second l'en retire (`toggleFlag(id)`). Pas d'éditeur.

- Même écriture que depuis la review (`saveWordPatch`), mais la liste étant visible on
  **re-rend tout de suite** au lieu de différer via `vocabDirty`, et `updateAvailNote()` remet à
  jour les compteurs du setup.
- `listFlagBusy` ignore un second clic sur le même mot tant que l'écriture court. Un refus RLS
  laisse la ligne telle quelle, avec le toast de `saveWordPatch`.

> Historique : jusqu'au 4 octobre 2026, le flag portait un motif au choix (`wrong_translation`,
> `typo`, `bad_example`, `to_study`, `other`) et une note libre, saisis dans un panneau de la review
> ou un éditeur en ligne dans la liste. Ils ont été fusionnés dans « Étudier plus tard » :
> `vocab_flag_single.sql` remappe les anciens flags (aucun mot ne sort de la liste) et interdit
> toute autre valeur. L'affichage ne lit jamais `flag_reason`, donc le front marche avant comme
> après la migration.

---

## 8. État & fonctions clés

```javascript
let vocab = []              // vocabulaire user + système
let progress = {}           // { wordId → {correct, attempts, ease_factor, …} }
let currentUser = null
let quizQueue = []          // items du quiz courant
let quizIndex = 0
let quizMode = 'auto'       // forward | reverse | auto
let sessionAnswers = []     // { word, correct, skipped, givenAnswer, direction }
let challengeContext = null // défini quand Challenge Back actif
let quizTimer = null        // intervalle du compte à rebours 30 s
let vocabDirty = false      // mot corrigé/flaggé en review → recharger plus tard (§7bis)
```

| Fonction | Rôle |
|----------|------|
| `startQuizTimer()` / `tickQuizTimer()` | Compte à rebours 30 s basé sur une échéance, gelé si la page est masquée, skip auto à 0 (§7). |
| `showQuestion()` | Rendu de la question courante. |
| `checkAnswer()` | Validation, enregistrement, mise à jour SM-2. |
| `advanceQuiz()` | Question suivante ou fin de session. |
| `stopQuiz()` / `resetSessionStop()` | Arrêt de la série en cours sur les questions déjà répondues, remise à zéro au départ de chaque session (§7). |
| `endSession()` | Stats, post au fil, review/résumé. |
| `buildQuizQueue()` | Entraînement libre : filtres, groupes, directions (§4). |
| `srsComposeDaily()` / `srsNewWordOrder()` | Séance du jour : composition et ordre des nouveaux mots — fonctions pures (§5). |
| `srsNext()` / `srsGrade()` / `srsDirection()` / `srsIsLeech()` | Moteur : état suivant d'un mot, note automatique, direction selon l'étape, sangsue — fonctions pures (§5). |
| `srsKpis()` / `srsRegulate()` | Indicateurs de pilotage et régulateur du budget de nouveaux mots — fonctions pures (§5). |
| `beginSession(kind, queue)` / `startDailySession()` | Démarrage d'une séance (`daily` / `free` / `challenge`). |
| `finishItem(item, r)` / `queueRelearn()` / `revealUnanswered()` | Fin d'une question (correction, note, enregistrement), re-questions, « Skip » et chrono écoulé. |
| `recordAnswer(word, grade, ctx)` | Premier essai d'un mot : état `srsNext()` dans `quiz_progress` + ligne de journal ; retire les colonnes que la base n'a pas. |
| `logAnswer(row)` / `loadAnswerLog()` | Journal `quiz_answers` (28 derniers jours en mémoire). |
| `loadSrsSettings()` / `runSrsRegulator()` | Réglages `quiz_settings` et passage quotidien du régulateur. |
| `renderDailyPanel()` / `renderKpiPanel()` | Panneau de la séance du jour ; tableau de bord de l'onglet Progress. |
| `saveWordPatch(id, patch)` | Écriture ciblée d'un patch sur un mot — mute l'objet en place, marque `vocabDirty`, **ne recharge pas** le vocabulaire. Partagée par la review et le flag depuis la liste (§7bis). |
| `flushVocabDirty()` | Repagination différée, une seule fois, hors review. |
| `flagPatch(on)` / `toggleFlag(id)` | Patch « Étudier plus tard » (ajout ou retrait) ; bascule en un clic depuis la liste de vocabulaire (§7bis). |
| `syncQuizFlagBtn()` / `resetSessionFlags()` | Flag pendant le test : état du bouton 🚩 de la question courante, remise à zéro des Sets de session (§7bis). |
| `computeVocabNumbers()` | Numéro permanent de chaque mot = rang de création (§7). Appelée par `loadVocab()`. |
| `sortVocabList(list)` | Tri de la liste selon `sortCol` / `sortDir`, vides en bas (§7). |
| `filterVocabForQuiz(filter)` | Filtres du quiz : langue, système, **plage de numéros** (§7). |
| `getPrintList(o)` / `runPrint()` | Sélection puis génération de `#print-area` — impression/étude (§7). |
| `buildPrintListHtml()` / `buildPrintCardsHtml()` / `buildPrintTestHtml()` | Les trois mises en page imprimables (§7). |
| `postMultiSession()` | INSERT dans `quiz_sessions`. |
| `launchChallengeQuiz()` | Mise en place du Challenge Back. |
| `publishChallengeResult()` | Publie le score en commentaire. |
| `runXpReconciliation()` | Évaluation/attribution XP quotidienne. |
| `multiLoadFeed()` | Fetch paginé du fil + hydratation réactions. |
| `multiLoadLeaderboard()` | Agrégation `user_xp` + `quiz_sessions`. |
| `grLoadProgress(userId)` | Charge `grammar_progress` dans `grProgress{}`. |
| `grSaveProgress(moduleId, correct, total)` | Upsert progression, calcule `status`/`trend`, poste la session, déclenche l'XP. |
| `grCheck(input, expected)` | Correction grammaire (normalisation stricte, alternatives `/`). |
| `grAwardMasteryXp(moduleId)` | +40 XP à la 1re maîtrise d'un chapitre. |

### Import/Export Excel
- **Export** (`XLSX.js`) : colonnes source, target, langue, exemples, tips, correct, attempts, ease_factor, last_tested.
- **Import** : lecture .xlsx, détection de doublons (insensible à la casse sur `(source_word, language_pair)`), upsert vocabulary + quiz_progress.
- **Lib manquante** : `ensureXLSX()` recharge `xlsx.min.js?reload=<ts>` à la demande si `XLSX` est absent au clic (vu sur Safari : `Can't find variable: XLSX` alors que le fichier servi est intact), et affiche « Module Excel introuvable » si ça échoue encore — plus d'erreur silencieuse.

---

## 9. Authentification & permissions

> ⚠️ **`/lazypo2/quiz.html` n'est plus gardé par le Worker.** La page est listée dans `PUBLIC_PAGES` (`worker/src/worker.js`) et servie **sans** vérification de JWT.
>
> Raison : la page est encadrée en iframe par Jarvis, qui peut ne pas porter le cookie au premier chargement. Un 302 aurait navigué **l'iframe** vers `login.html`. Le HTML part donc ungated et `quiz.html` applique sa propre garde en place (§13).
>
> **Conséquence** : ne jamais mettre de donnée sensible dans le markup de `quiz.html`. La vraie frontière est la **RLS Supabase**, pas le Worker.

- Le Worker continue d'injecter les en-têtes de sécurité + la CSP sur la réponse (dont `frame-ancestors 'self' https://jarvis.ndashiz.be`).
- Module `quiz` dans `allowed_modules` (défaut pour nouveaux users).
- Supabase Auth (email/mot de passe ou OAuth). RLS : chaque user ne lit/écrit que ses propres données.
- Toutes les libs sont **vendorisées** (`supabase.min.js`, `xlsx.min.js`…) : la CSP est `script-src 'self'`, un CDN serait bloqué en prod.

---

## 10. Performance & cache

- Cache du fil multi : TTL ~2 min (refresh manuel pour invalider).
- Pagination : 20 sessions/page.
- Chargement du vocabulaire : paginé au-delà de la limite 1000 lignes Supabase.
- Démo : bypass de la DB, données en mémoire.

---

## 11. Architecture

```
quiz.html (SPA, vanilla JS, CSS variables, sans framework)
 ├─ 5 onglets : Quiz | Vocab | Progress | Multi | Grammaire
 │                                                └─ ch.23 → entraîneur verbes NL
 ├─ État : vocab[], progress{}, grProgress{}, session
 └─ Intégrations : Supabase, XLSX.js, Pravatar
        │
Supabase ── Auth · 10 tables + RLS · Storage (avatars)
        │
Cloudflare Worker ── CSP + headers · quiz.html NON gardé (PUBLIC_PAGES)
        │
        └─ embed : <iframe> depuis jarvis.ndashiz.be (same-site, cross-origin)
                   session Supabase dédiée `sb-lazypo-embed-auth-token`
```

---

## 12. Module Grammaire

Onglet **📖 Grammaire** — cours de néerlandais noté, entièrement inline dans `quiz.html` (`var TOPICS = [...]`, ~900 lignes de données).

### Structure

23 chapitres, chacun `{ id, title, subtitle, theory (HTML), exercises: [{p, a, h?}] }` :

| # | Chapitre | # | Chapitre |
|---|----------|---|----------|
| 1 | Pluriel des noms | 13 | Conditionnel passé (VVTkT) |
| 2 | Pronoms personnels | 14 | La phrase simple |
| 3 | L'adjectif (règle du -e) | 15 | La négation (niet vs geen) |
| 4 | Degrés de comparaison | 16 | La phrase complexe |
| 5 | Hebben & Zijn | 17 | La proposition relative |
| 6 | Présent (OTT) | 18 | La proposition infinitive |
| 7 | Prétérit (OVT) | 19 | Kunnen |
| 8 | Passé composé (VTT) | 20 | Moeten |
| 9 | Plus-que-parfait | 21 | Phrases interrogatives |
| 10 | Futur simple (OTkT) | 22 | Prépositions |
| 11 | Futur antérieur (VTkT) | 23 | **Verbes irréguliers** (embarque l'entraîneur de conjugaison) |
| 12 | Conditionnel présent (OVkT) | | |

Les 22 premières théories sont alignées sur le PDF du cours (`eaba158`).

### UI — 2 panneaux

1. **Grille de cartes** — une carte par chapitre, badge de statut (`todo` / `in_progress` / `mastered`), meilleur score, barre de progression globale « N / 23 modules maîtrisés ».
2. **Détail** — théorie (`t.theory`, HTML riche) puis exercices notés.

### Correction — `grCheck()` / `grNorm()`

Normalisation : trim, minuscules, espaces multiples réduits, apostrophes typographiques unifiées (`'` → `'`), point final ignoré. Réponses alternatives séparées par `/`. Plus strict que le quiz vocabulaire : **pas** de tolérance aux accents ni de distance de typo.

### Notation & progression — `grSaveProgress()`

- Score en % → poussé dans `scores_history` (10 derniers).
- `status = 'mastered'` dès que la **moyenne** de la fenêtre ≥ 80 % (pas le meilleur score).
- `best_score` = max historique ; `trend` = delta avec la tentative précédente.
- Chaque session poste dans `quiz_sessions` avec `mode: 'grammar'` → **visible dans le fil Multi**.
- Première maîtrise → +40 XP immédiats (§5).

---

## 13. Embed Jarvis

`quiz.html` est encadré en iframe par le front Jarvis (`jarvis.ndashiz.be` → `ndashiz.be/lazypo2/quiz.html`) : **cross-origin mais same-site**, donc les deux partagent la partition de stockage.

### Détection

```js
try { if (window.top !== window.self) document.documentElement.classList.add('qz-embed'); }
catch(_) { document.documentElement.classList.add('qz-embed'); }
```

Le `catch` compte comme embed : un `window.top` qui throw signifie justement qu'on est encadré cross-origin.

### Ce que fait le mode embed

| Aspect | Comportement |
|---|---|
| Chrome LazyPO | Sidebar, burger, overlay et barre Focus FM masqués (`html.qz-embed`) ; titre de page masqué (Jarvis a déjà sa topbar) |
| Session Supabase | **Client dédié** : `auth.js` crée le client avec `storageKey: 'sb-lazypo-embed-auth-token'` |
| Cookie de gate | **Jamais écrit ni effacé** en embed (`if (!IS_EMBED)`) |
| Timeout d'inactivité | `session.js` désactivé — la session embed survit |
| Sign-out LazyPO | Sans effet sur l'embed (scope `local`, storage key différente) |
| Pas de session | Carte de login **dans l'iframe** (`#qz-embed-gate`), jamais de navigation vers `login.html` |

### Invariant

> Tout code qui appelle `LazyAuth.requireAuth()` doit d'abord `await window.__qzEmbedAuth`. Sinon il court-circuite la garde, voit une session `null`, et **fait sortir l'iframe vers `login.html`** — précisément le bug corrigé par `cef5166` / `3eba74b`.

L'isolation de session (`b83a4ac`) fait qu'on ne se logge **qu'une fois** : le refresh token de l'embed vit dans sa propre storage key et n'est plus détruit par la politique d'inactivité ni par les sign-out de LazyPO.

Côté Worker : `frame-ancestors 'self' https://jarvis.ndashiz.be`, `X-Frame-Options` **supprimé** (XFO ne sait pas exprimer « ce sous-domaine-là »), et `/lazypo2/quiz.html` dans `PUBLIC_PAGES` (§9).

---

## 14. Historique git (thèmes principaux)

Commits notables (récent → ancien) :

**Moteur d'apprentissage v2 (octobre 2026)**

- Séance du jour composée par le moteur, parcours réception → production, notation à 4 niveaux, re-questions, « Skip » qui montre la réponse, « Précédent » en lecture seule, journal `quiz_answers`, régulateur, tableau de bord KPI, XP réalignée, drapeaux de langue — `quiz_srs_v2.sql`
- Arrêter une série en cours (⏹ Stop) ; Flagger réduit à « Étudier plus tard » (`vocab_flag_single.sql`) ; séries de 100 ; atelier sangsues retiré

**Embed Jarvis (juillet 2026)**

- `b83a4ac` fix(quiz/embed) : isolation de la session embed — se logger une seule fois
- `3eba74b` fix(quiz/embed) : garde d'auth en place — l'iframe ne sort plus vers login.html
- `cef5166` fix(quiz/embed) : carte de login inline au lieu d'une redirection
- `e7729b2` fix(quiz) : autoriser le framing depuis jarvis.ndashiz.be (cross-origin, same-site)
- `999440d` feat(quiz) : autoriser l'embed iframe same-origin depuis Jarvis
- `8abda52` / `629f154` fix(csp) : restaurer les libs vendorisées — les CDN sont bloqués par la CSP du Worker

**Module Grammaire (juillet 2026)**

- `eaba158` feat(grammar) : les 22 théories alignées sur le PDF du cours
- `8744422` feat(grammar) : TOPICS étendu à 23 chapitres (syllabus PDF)
- `c235f2f` feat(grammar) : module grammaire unifié — cartes, quiz, XP, multi-feed
- `7c96214` fix(grammar) : ne plus fermer le cours/quiz au retour d'onglet
- `f6fed22` / `7d2d863` fix(grammar) : `getSession` au lieu de `getUser` (timeout 30 s / SIGNED_OUT parasite)

**Antérieur**

- `b541521` fix(quiz/multi) : sync cross-user du fil + leaderboard
- `f56c9b0` Merge PR #92 : fix quiz review cleanup
- `87cf79c` fix(quiz) : masquer Error Review au démarrage d'un nouveau quiz
- `43bd592` fix(quiz) : race condition au boot — `currentUser` null
- `e2b03d4` feat(quiz/vocab) : onboarding premier import + détection de doublons
- `c400e66` feat(quiz/share) : filtre langue, select/deselect all, partage direct
- `960be76` feat(quiz) : multi demo admin, Challenge Back fin de partie, vocab share
- `fab0727` feat(multi) : ajouter les mots Challenge Back à son vocabulaire
- `0c1ffad` fix(quiz) : formulaire d'ajout vocab — champ source adaptatif unique
- `37e0d3a` / `d92098a` fix(vocab) : suppression de la pagination
- `25eed19` feat(vocab) : refonte complète de l'onglet Vocabulary
- `0ad486d` feat(quiz) : option 50 questions
- `2209e44` feat(vocab) : filtre mots ratés/fragiles + marquage visuel + impression
- `33ef103` refactor : intégration des verbes NL dans quiz.html (4e onglet)
- `8febfb4` feat : verbes irréguliers NL + hint visible par défaut
- `f35a472` feat : écran de review des erreurs + stats gamifiées (streak, heatmap, temps)
- `93a9a8d` feat : countdowns projet personnalisables + carte Knowledge Quiz sur l'accueil

**Thèmes** : features social multijoueur (Challenge Back, réactions, classement), système XP/gamification, partage de vocabulaire, intégration verbes NL, sécurité cross-user, corrections de race conditions.
