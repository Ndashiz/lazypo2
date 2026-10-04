-- ═══════════════════════════════════════════════════════════════════
-- LazyPO — Quiz : le Flagger n'a plus qu'une catégorie, « Étudier plus tard »
-- ───────────────────────────────────────────────────────────────────
-- Pourquoi : un mot flaggé pouvait porter cinq motifs (wrong_translation,
-- typo, bad_example, to_study, other). Le Flagger n'a désormais qu'une
-- fonction : flagger un mot, c'est l'ajouter à « Étudier plus tard »
-- (valeur stockée : to_study). Le front (quiz.html) n'écrit plus que
-- cette valeur et n'affiche plus aucun motif.
--
-- Ce script :
--   1. sauvegarde les motifs actuels (table sans policy, invisible à l'API) ;
--   2. remappe TOUS les mots flaggés vers to_study — aucun mot ne quitte la
--      liste, flagged_at n'est pas touché (l'ordre « flag le plus récent
--      d'abord » est conservé) ;
--   3. interdit toute autre valeur (contrainte CHECK).
-- Idempotent : peut être relancé sans effet de bord.
--
-- Ordre : à lancer APRÈS le push du front et l'expiration du cache
-- Cloudflare (~15 min). Une ancienne version de quiz.html encore en cache
-- écrirait un ancien motif et se ferait refuser par la contrainte.
-- Sans ce script, le front fonctionne déjà : il traite tout mot flaggé comme
-- « Étudier plus tard », quel que soit le motif resté en base.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Sauvegarde des anciens motifs, pour pouvoir revenir en arrière.
--    Créée une seule fois : une relance ne l'écrase pas.
create table if not exists public.vocabulary_flag_backup as
  select id as word_id, user_id, flagged_at, flag_reason, flag_note, now() as saved_at
    from public.vocabulary
   where flagged_at is not null or flag_reason is not null;

-- RLS sans aucune policy : la table est invisible pour l'API (anon / authenticated)
alter table public.vocabulary_flag_backup enable row level security;

-- 2a. Remap : chaque mot flaggé passe dans « Étudier plus tard »
update public.vocabulary
   set flag_reason = 'to_study'
 where flagged_at is not null
   and flag_reason is distinct from 'to_study';

-- 2b. Un motif sans flag n'a pas de sens (aucune ligne attendue)
update public.vocabulary
   set flag_reason = null
 where flagged_at is null
   and flag_reason is not null;

-- 3. Plus aucune autre catégorie possible
alter table public.vocabulary
  drop constraint if exists vocabulary_flag_reason_single;
alter table public.vocabulary
  add constraint vocabulary_flag_reason_single
  check (flag_reason is null or flag_reason = 'to_study');

comment on column public.vocabulary.flag_reason is
  'Toujours ''to_study'' quand le mot est flaggé : la seule catégorie du Flagger, « Étudier plus tard » (vocab_flag_single.sql).';

-- Vérification : doit renvoyer une seule ligne, to_study
-- select flag_reason, count(*) from public.vocabulary where flagged_at is not null group by 1;

-- Retour arrière (seulement si besoin) :
-- alter table public.vocabulary drop constraint if exists vocabulary_flag_reason_single;
-- update public.vocabulary v set flag_reason = b.flag_reason
--   from public.vocabulary_flag_backup b
--  where b.word_id = v.id and v.flagged_at is not null;
--
-- Quand tout est validé, la sauvegarde peut partir :
-- drop table public.vocabulary_flag_backup;
