-- ═══════════════════════════════════════════════════════════════════
-- LazyPO — Quiz : moteur d'apprentissage v2 (séance du jour, parcours d'un
-- mot, journal des réponses, régulateur, atelier sangsues)
-- ───────────────────────────────────────────────────────────────────
-- Pourquoi : l'audit du 4 octobre 2026 a montré que les nouveaux mots ne
-- recevaient que les places restantes, que les échecs revenaient le
-- lendemain sans avoir été réappris, et que les révisions anticipées
-- gonflaient les intervalles (jusqu'à 76 488 jours). Le front (quiz.html)
-- compose désormais une séance du jour, fait passer chaque mot par des
-- étapes (apprentissage → réception → production) et journalise chaque
-- réponse pour piloter le nombre de nouveaux mots.
--
-- Ce script :
--   1. ajoute les colonnes d'état sur quiz_progress (étape, oublis,
--      première question) et la fenêtre glissante `recent` si
--      quiz_progress_recent.sql n'a jamais été passé ;
--   2. initialise ces colonnes pour les mots déjà travaillés ;
--   3. ramène à 30 jours les intervalles gonflés par l'ancien moteur ;
--   4. ajoute la suspension d'un mot (vocabulary.suspended_at) ;
--   5. crée le journal des réponses (quiz_answers) et les réglages du
--      moteur (quiz_settings), avec RLS : chacun ne voit que ses lignes.
-- Idempotent : peut être relancé sans effet de bord.
--
-- Sans ce script, le front fonctionne quand même : il garde l'état en
-- mémoire pendant la séance, retombe sur le compteur local de nouveaux
-- mots, et le tableau de bord indique que le journal est indisponible.
-- ═══════════════════════════════════════════════════════════════════

-- 1. État du mot dans le parcours
alter table public.quiz_progress add column if not exists recent       jsonb default '[]'::jsonb;
alter table public.quiz_progress add column if not exists stage        text;          -- learn | recv | prod
alter table public.quiz_progress add column if not exists lapses       int;           -- oublis depuis le dernier atelier
alter table public.quiz_progress add column if not exists first_tested timestamptz;   -- première question posée

comment on column public.quiz_progress.stage is
  'Étape du mot : learn (apprentissage), recv (réception NL→FR), prod (production FR→NL). null + attempts = 0 : nouveau.';
comment on column public.quiz_progress.lapses is
  'Oublis (réponses ratées) depuis le dernier atelier sangsues. Sangsue = 4 oublis et moins de 50 % de réussite.';

-- 2. Mots déjà travaillés : leurs échecs passés comptent comme oublis, et
--    ils reprennent en réception (l'ancien moteur mélangeait les deux sens).
--    Ne touche que les lignes pas encore migrées (stage null).
update public.quiz_progress
   set lapses = greatest(0, attempts - correct)
 where stage is null and attempts > 0;

update public.quiz_progress
   set stage = 'recv'
 where stage is null and attempts > 0;

-- 3. Intervalles gonflés par les révisions anticipées de l'ancien moteur.
--    Ne touche que les lignes notées avant la v2 : une relance plus tard
--    laisse intacts les intervalles calculés par le nouveau moteur.
update public.quiz_progress
   set interval_days = 30
 where interval_days > 30
   and last_tested < '2026-10-05';

-- 4. Suspension : un mot suspendu ne sort plus dans aucune série
alter table public.vocabulary add column if not exists suspended_at timestamptz;

comment on column public.vocabulary.suspended_at is
  'Mot suspendu depuis l''atelier sangsues : exclu de toutes les séries tant qu''il n''est pas réactivé.';

-- 5a. Journal des réponses : une ligne par réponse, re-questions comprises
create table if not exists public.quiz_answers (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  word_id          uuid references public.vocabulary(id) on delete set null,
  session_key      text,                          -- identifiant de la séance (côté client)
  mode             text,                          -- daily | free | challenge | atelier
  answered_at      timestamptz not null default now(),
  direction        text not null,                 -- forward | reverse | cloze
  stage            text,                          -- étape du mot avant la réponse : new | learn | recv | prod
  grade            smallint,                      -- 1 raté · 2 difficile · 3 bien · 4 facile ; null = re-question
  correct          boolean not null,
  close_match      boolean not null default false,
  first_key_ms     int,                           -- temps avant la première frappe
  total_ms         int,
  is_new           boolean not null default false,
  is_relearn       boolean not null default false,
  is_leech         boolean not null default false,
  was_due          boolean,
  elapsed_days     real,
  interval_before  int,
  interval_after   int
);

alter table public.quiz_answers enable row level security;
drop policy if exists "own_answers" on public.quiz_answers;
create policy "own_answers" on public.quiz_answers
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists quiz_answers_user_time on public.quiz_answers (user_id, answered_at desc);

-- 5b. Réglages du moteur : le nombre de nouveaux mots par jour, ajusté une
--     fois par jour par le régulateur (rétention, retard, sangsues)
create table if not exists public.quiz_settings (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  new_per_day  int  not null default 8,
  adjusted_on  date,
  last_reason  text,
  updated_at   timestamptz not null default now()
);

alter table public.quiz_settings enable row level security;
drop policy if exists "own_quiz_settings" on public.quiz_settings;
create policy "own_quiz_settings" on public.quiz_settings
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Vérifications :
-- select stage, count(*) from public.quiz_progress group by 1;
-- select count(*) from public.quiz_progress where interval_days > 30;
-- select count(*) from public.quiz_answers;
