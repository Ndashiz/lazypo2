-- ═══════════════════════════════════════════════════════════════════
-- LazyPO — Dépôt : documents dictés depuis le téléphone (mcp/)
-- ───────────────────────────────────────────────────────────────────
-- Pourquoi : le connecteur vocal (mcp/server.mjs) laisse Claude déposer
-- un document créé pendant la conversation — un BPMN structuré puis mis
-- en page par le serveur, une note, un schéma Mermaid, un SQL… — pour
-- qu'il soit lisible sur le téléphone dans LazyPO (depot.html).
-- Une table, pas un bucket : le contenu est du texte, la page le rend
-- (bpmn-js pour le BPMN) et l'exporte en fichier.
--
-- À exécuter une fois dans le SQL Editor Supabase. Idempotent.
-- Sans cette table, le serveur MCP garde le document sur le Mac
-- (~/.config/lazypo-mcp/docs/) et le dit ; depot.html affiche que la
-- table manque.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.voice_docs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  format      text not null check (format in ('bpmn','md','mmd','txt','sql','json','csv','xml','svg')),
  content     text not null,
  meta        jsonb not null default '{}'::jsonb,   -- bpmn : la structure dictée (elements, flux) + avertissements
  source      text not null default 'voice',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.voice_docs is
  'Documents déposés par le canal vocal (mcp/). format = bpmn | md | mmd | txt | sql | json | csv | xml | svg. '
  'meta.structure garde, pour un BPMN, la structure dictée que Claude relit pour le modifier.';

alter table public.voice_docs enable row level security;
drop policy if exists "own_voice_docs" on public.voice_docs;
create policy "own_voice_docs" on public.voice_docs
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists voice_docs_user_time on public.voice_docs (user_id, created_at desc);

-- Vérification :
-- select format, count(*) from public.voice_docs group by 1;
