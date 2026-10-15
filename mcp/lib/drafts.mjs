/**
 * drafts.mjs — words dictated by voice wait here, on the Mac, until Simon
 * validates them on the local page. Voice transcription mangles Dutch; a
 * draft costs nothing to fix, a wrong word in the quiz pool costs a review.
 */
import { randomUUID } from 'node:crypto';
import { DRAFTS_PATH, readJson, writeJsonPrivate } from './config.mjs';

export function listDrafts() {
  const d = readJson(DRAFTS_PATH, { drafts: [] });
  return Array.isArray(d.drafts) ? d.drafts : [];
}
function save(drafts) { writeJsonPrivate(DRAFTS_PATH, { drafts }); }

export function addDraft({ mot, traduction, exemple = '', astuce = '', infos = '' }) {
  const drafts = listDrafts();
  const draft = {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    mot: String(mot).trim(), traduction: String(traduction).trim(),
    exemple: String(exemple || '').trim(), astuce: String(astuce || '').trim(), infos: String(infos || '').trim(),
  };
  drafts.push(draft);
  save(drafts);
  return { draft, pending: drafts.length };
}

export function removeDraft(id) {
  const drafts = listDrafts();
  const next = drafts.filter(d => d.id !== id);
  const removed = drafts.length !== next.length;
  if (removed) save(next);
  return removed;
}

export function getDraft(id) { return listDrafts().find(d => d.id === id) || null; }
