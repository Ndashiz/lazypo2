/**
 * docs.mjs — the drop-off: documents dictated on the phone, kept in LazyPO.
 *
 * A BPMN is dictated as a STRUCTURE (elements + flows), never as XML: the
 * model speaks a few hundred tokens, the server writes the XML and
 * bpmn-auto-layout draws it. depot.html renders it with bpmn-js.
 *
 * Storage: Supabase `voice_docs` (voice_docs_schema.sql, RLS own rows). When
 * the table is missing the document stays on the Mac and the answer says so.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { layoutProcess } from 'bpmn-auto-layout';
import { CONFIG_DIR, readJson, writeJsonPrivate } from './config.mjs';
import { shortDate, clock, plural } from './fmt.mjs';

export const FORMATS = ['bpmn', 'md', 'mmd', 'txt', 'sql', 'json', 'csv', 'xml', 'svg'];
export const MAX_CONTENT = 300_000;
const LOCAL_DIR = join(CONFIG_DIR, 'docs');
const LOCAL_INDEX = join(LOCAL_DIR, 'index.json');

/* ── BPMN from a structure ────────────────────────────────────── */
export const ELEMENT_TYPES = {
  debut:        { tag: 'startEvent' },
  fin:          { tag: 'endEvent' },
  tache:        { tag: 'task' },
  utilisateur:  { tag: 'userTask' },
  service:      { tag: 'serviceTask' },
  manuel:       { tag: 'manualTask' },
  script:       { tag: 'scriptTask' },
  envoi:        { tag: 'sendTask' },
  reception:    { tag: 'receiveTask' },
  decision:     { tag: 'exclusiveGateway' },
  parallele:    { tag: 'parallelGateway' },
  inclusif:     { tag: 'inclusiveGateway' },
  attente:      { tag: 'intermediateCatchEvent', def: 'timerEventDefinition' },
  message:      { tag: 'intermediateCatchEvent', def: 'messageEventDefinition' },
  evenement:    { tag: 'intermediateThrowEvent' },
};
export const TYPE_NAMES = Object.keys(ELEMENT_TYPES);

const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'x';

/** Validate the dictated structure. Returns { ok, errors, warnings, elements, flows }. */
export function checkStructure({ elements, flux }) {
  const errors = [], warnings = [];
  const els = Array.isArray(elements) ? elements : [];
  const flows = Array.isArray(flux) ? flux : [];
  if (els.length < 2) errors.push('il faut au moins deux éléments');
  const ids = new Set();
  const norm = els.map((e, i) => {
    const type = String(e && e.type || '').toLowerCase();
    const id = slug(e && e.id ? e.id : `e${i + 1}`);
    if (!TYPE_NAMES.includes(type)) errors.push(`élément « ${e && (e.nom || e.id) || i + 1} » : type inconnu « ${type} » (attendu : ${TYPE_NAMES.join(', ')})`);
    if (ids.has(id)) errors.push(`identifiant en double : ${id}`);
    ids.add(id);
    return { id, type, nom: String(e && e.nom || '').trim(), voie: String(e && e.voie || '').trim() };
  });
  if (!norm.some(e => e.type === 'debut')) errors.push('il faut un élément de type « debut »');
  if (!norm.some(e => e.type === 'fin')) warnings.push('aucun élément « fin » : le processus ne se termine pas explicitement');
  const idOf = ref => slug(ref);
  const normFlows = flows.map((f, i) => {
    const de = idOf(f && f.de), vers = idOf(f && f.vers);
    if (!ids.has(de)) errors.push(`flux ${i + 1} : « ${f && f.de} » n'existe pas`);
    if (!ids.has(vers)) errors.push(`flux ${i + 1} : « ${f && f.vers} » n'existe pas`);
    return { id: `Flow_${i + 1}`, de, vers, nom: String(f && f.nom || '').trim() };
  });
  const out = new Map(), inn = new Map();
  for (const f of normFlows) { out.set(f.de, (out.get(f.de) || 0) + 1); inn.set(f.vers, (inn.get(f.vers) || 0) + 1); }
  for (const e of norm) {
    if (e.type !== 'debut' && !inn.get(e.id)) warnings.push(`« ${e.nom || e.id} » n'a aucun flux entrant`);
    if (e.type !== 'fin' && !out.get(e.id)) warnings.push(`« ${e.nom || e.id} » n'a aucun flux sortant`);
    if (['decision', 'inclusif'].includes(e.type) && (out.get(e.id) || 0) >= 2) {
      const unnamed = normFlows.filter(f => f.de === e.id && !f.nom).length;
      if (unnamed) warnings.push(`décision « ${e.nom || e.id} » : ${plural(unnamed, 'branche sans libellé', 'branches sans libellé')} (oui / non, montant > 1000…)`);
    }
    if (!e.nom && !['debut', 'fin'].includes(e.type)) warnings.push(`élément ${e.id} sans nom`);
  }
  return { ok: !errors.length, errors, warnings, elements: norm, flows: normFlows };
}

/** BPMN 2.0 XML, semantics only (no DI): bpmn-auto-layout draws it next. */
export function buildBpmnXml(titre, { elements, flows }) {
  const procId = 'Process_' + slug(titre).slice(0, 24);
  const lanes = [...new Set(elements.map(e => e.voie).filter(Boolean))];
  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push('<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_lazypo" targetNamespace="http://ndashiz.be/lazypo2/bpmn" exporter="LazyPO voice" exporterVersion="1.0">');
  L.push(`  <bpmn:process id="${procId}" name="${esc(titre)}" isExecutable="false">`);
  if (lanes.length) {
    L.push('    <bpmn:laneSet id="LaneSet_1">');
    lanes.forEach((lane, i) => {
      L.push(`      <bpmn:lane id="Lane_${i + 1}" name="${esc(lane)}">`);
      elements.filter(e => e.voie === lane).forEach(e => L.push(`        <bpmn:flowNodeRef>${e.id}</bpmn:flowNodeRef>`));
      L.push('      </bpmn:lane>');
    });
    L.push('    </bpmn:laneSet>');
  }
  for (const e of elements) {
    const t = ELEMENT_TYPES[e.type];
    const inc = flows.filter(f => f.vers === e.id), out = flows.filter(f => f.de === e.id);
    L.push(`    <bpmn:${t.tag} id="${e.id}"${e.nom ? ` name="${esc(e.nom)}"` : ''}>`);
    if (e.voie) L.push(`      <bpmn:documentation>Rôle : ${esc(e.voie)}</bpmn:documentation>`);
    inc.forEach(f => L.push(`      <bpmn:incoming>${f.id}</bpmn:incoming>`));
    out.forEach(f => L.push(`      <bpmn:outgoing>${f.id}</bpmn:outgoing>`));
    if (t.def) L.push(`      <bpmn:${t.def} id="${e.id}_def" />`);
    L.push(`    </bpmn:${t.tag}>`);
  }
  for (const f of flows) {
    L.push(`    <bpmn:sequenceFlow id="${f.id}" sourceRef="${f.de}" targetRef="${f.vers}"${f.nom ? ` name="${esc(f.nom)}"` : ''} />`);
  }
  L.push('  </bpmn:process>');
  L.push('</bpmn:definitions>');
  return L.join('\n');
}

export function hasDiagram(xml) { return /<(bpmndi:)?BPMNShape\b/.test(xml); }
export function looksLikeBpmn(xml) { return /<(\w+:)?definitions\b/.test(xml) && /<(\w+:)?process\b/.test(xml); }

/** Adds the diagram (DI) when missing. Throws with a readable message. */
export async function layoutBpmn(xml) {
  if (hasDiagram(xml)) return { xml, laidOut: false };
  try {
    return { xml: await layoutProcess(xml), laidOut: true };
  } catch (e) {
    throw new Error(`mise en page BPMN impossible : ${e.message || e}`);
  }
}

/** The whole road: structure → XML → layout. */
export async function makeBpmn(titre, structure) {
  const check = checkStructure(structure);
  if (!check.ok) return { ok: false, errors: check.errors, warnings: check.warnings };
  const bare = buildBpmnXml(titre, check);
  const { xml } = await layoutBpmn(bare);
  const counts = { elements: check.elements.length, flows: check.flows.length, lanes: new Set(check.elements.map(e => e.voie).filter(Boolean)).size };
  return { ok: true, xml, warnings: check.warnings, counts, structure: { elements: check.elements, flux: check.flows.map(f => ({ de: f.de, vers: f.vers, nom: f.nom || undefined })) } };
}

/* ── Storage ──────────────────────────────────────────────────── */
function tableMissing(error) {
  return !!error && (error.code === '42P01' || /voice_docs|schema cache/i.test(error.message || ''));
}
function ensureLocal() { if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true, mode: 0o700 }); }
function localIndex() { return readJson(LOCAL_INDEX, { docs: [] }).docs || []; }
function localSave(row) {
  ensureLocal();
  writeFileSync(join(LOCAL_DIR, `${row.id}.${row.format}`), row.content, { mode: 0o600 });
  const docs = localIndex().filter(d => d.id !== row.id);
  docs.push({ id: row.id, title: row.title, format: row.format, meta: row.meta, created_at: row.created_at, updated_at: row.updated_at, size: row.content.length });
  writeJsonPrivate(LOCAL_INDEX, { docs });
}
function localRead(id) {
  const d = localIndex().find(x => x.id === id);
  if (!d) return null;
  try { return { ...d, content: readFileSync(join(LOCAL_DIR, `${d.id}.${d.format}`), 'utf8'), where: 'local' }; } catch { return null; }
}

export function docUrl(cfg, id) { return `${cfg.appUrl}depot.html#${id}`; }

/**
 * Save (or replace, with `id`) a document. Returns { id, where, created }.
 * `where` = 'supabase' | 'local' (table missing — said out loud by the caller).
 */
export async function saveDoc(sb, uid, { id, title, format, content, meta = {} }) {
  if (!FORMATS.includes(format)) throw new Error(`format « ${format} » inconnu (${FORMATS.join(', ')})`);
  if (typeof content !== 'string' || !content.trim()) throw new Error('contenu vide');
  if (content.length > MAX_CONTENT) throw new Error(`contenu trop long (${content.length} caractères, maximum ${MAX_CONTENT})`);
  title = String(title || '').trim().slice(0, 120) || 'Sans titre';
  const now = new Date().toISOString();
  if (id) {
    const { data, error } = await sb.from('voice_docs').update({ title, format, content, meta, updated_at: now }).eq('id', id).eq('user_id', uid).select('id');
    if (error && !tableMissing(error)) throw new Error(`voice_docs : ${error.message}`);
    if (!error) {
      if (!data || !data.length) throw new Error(`document ${id} introuvable (ou pas à toi) : rien n'a été modifié`);
      return { id, where: 'supabase', created: false };
    }
    const local = localRead(id);
    if (!local) throw new Error(`document ${id} introuvable sur le Mac : rien n'a été modifié`);
    localSave({ ...local, title, format, content, meta, updated_at: now });
    return { id, where: 'local', created: false };
  }
  const { data, error } = await sb.from('voice_docs').insert({ user_id: uid, title, format, content, meta, source: 'voice' }).select('id').single();
  if (!error) return { id: data.id, where: 'supabase', created: true };
  if (!tableMissing(error)) throw new Error(`voice_docs : ${error.message}`);
  const newId = randomUUID();
  localSave({ id: newId, title, format, content, meta, created_at: now, updated_at: now });
  return { id: newId, where: 'local', created: true };
}

export async function listDocs(sb, uid, { limit = 10, search = '' } = {}) {
  let q = sb.from('voice_docs').select('id, title, format, meta, created_at, updated_at').eq('user_id', uid).order('updated_at', { ascending: false }).limit(limit);
  if (search) q = q.ilike('title', `%${search.replace(/[%_]/g, '')}%`);
  const { data, error } = await q;
  let rows = [], where = 'supabase';
  if (error) { if (!tableMissing(error)) throw new Error(`voice_docs : ${error.message}`); where = 'local'; }
  else rows = (data || []).map(r => ({ ...r, where: 'supabase' }));
  const local = localIndex().filter(d => !search || d.title.toLowerCase().includes(search.toLowerCase())).map(d => ({ ...d, where: 'local' }));
  rows = rows.concat(local).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, limit);
  return { rows, where };
}

export async function readDoc(sb, uid, id) {
  const { data, error } = await sb.from('voice_docs').select('*').eq('id', id).eq('user_id', uid).maybeSingle();
  if (error && !tableMissing(error)) throw new Error(`voice_docs : ${error.message}`);
  if (data) return { ...data, where: 'supabase' };
  return localRead(id);
}

/* ── Text for the model ───────────────────────────────────────── */
export function formatDocList(rows, cfg, where) {
  if (!rows.length) return `Aucun document déposé pour l'instant${where === 'local' ? ' (table voice_docs absente : seuls les documents du Mac seraient listés)' : ''}. Rien à ouvrir.`;
  const L = [`${plural(rows.length, 'document déposé', 'documents déposés')} (les plus récents d'abord) :`];
  for (const r of rows) {
    L.push(`• ${r.title} — ${r.format}${r.meta && r.meta.counts ? ` (${r.meta.counts.elements} éléments, ${r.meta.counts.flows} flux)` : ''} · ${shortDate(r.updated_at)} ${clock(r.updated_at)} · id ${r.id}` +
      (r.where === 'local' ? ' · sur le Mac seulement' : ` · ${docUrl(cfg, r.id)}`));
  }
  return L.join('\n');
}
