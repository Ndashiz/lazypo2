import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStructure, buildBpmnXml, makeBpmn, hasDiagram, looksLikeBpmn, TYPE_NAMES, formatDocList } from '../lib/docs.mjs';

const structure = {
  elements: [
    { id: 'debut', type: 'debut', nom: 'Demande reçue', voie: 'Client' },
    { id: 't1', type: 'utilisateur', nom: 'Vérifier la demande', voie: 'PO' },
    { id: 'd1', type: 'decision', nom: 'Complète ?', voie: 'PO' },
    { id: 't2', type: 'envoi', nom: 'Demander un complément', voie: 'PO' },
    { id: 't3', type: 'service', nom: 'Créer le ticket', voie: 'Système' },
    { id: 'fin', type: 'fin', nom: 'Ticket créé' },
  ],
  flux: [
    { de: 'debut', vers: 't1' }, { de: 't1', vers: 'd1' }, { de: 'd1', vers: 't2', nom: 'non' }, { de: 't2', vers: 't1' },
    { de: 'd1', vers: 't3', nom: 'oui' }, { de: 't3', vers: 'fin' },
  ],
};

test('checkStructure: a sound process passes without warnings', () => {
  const c = checkStructure(structure);
  assert.equal(c.ok, true);
  assert.deepEqual(c.warnings, []);
  assert.equal(c.elements.length, 6);
  assert.equal(c.flows[0].id, 'Flow_1');
});

test('checkStructure: the code refuses what it cannot draw and warns about the rest', () => {
  const c = checkStructure({
    elements: [{ id: 'debut', type: 'debut' }, { id: 'a', type: 'tache' }, { id: 'a', type: 'xyz', nom: 'dup' }, { id: 'd', type: 'decision', nom: 'ok ?' }],
    flux: [{ de: 'debut', vers: 'a' }, { de: 'a', vers: 'nope' }, { de: 'd', vers: 'a' }, { de: 'd', vers: 'debut' }],
  });
  assert.equal(c.ok, false);
  assert.ok(c.errors.some(e => /type inconnu/.test(e)));
  assert.ok(c.errors.some(e => /en double/.test(e)));
  assert.ok(c.errors.some(e => /n'existe pas/.test(e)));
  assert.ok(c.warnings.some(w => /aucun élément « fin »/.test(w)));
  assert.ok(c.warnings.some(w => /sans libellé/.test(w)));
  assert.ok(c.warnings.some(w => /sans nom/.test(w)));
});

test('buildBpmnXml: valid BPMN 2.0 semantics, lanes, escaping, event definitions', () => {
  const c = checkStructure({ ...structure, elements: structure.elements.concat([{ id: 'w', type: 'attente', nom: 'J+2 <& "délai">' }]), flux: structure.flux.concat([{ de: 't2', vers: 'w' }]) });
  const xml = buildBpmnXml('Demande & suite', c);
  assert.ok(looksLikeBpmn(xml));
  assert.ok(!hasDiagram(xml));
  assert.match(xml, /<bpmn:process id="Process_Demande_suite" name="Demande &amp; suite"/);
  assert.match(xml, /<bpmn:userTask id="t1" name="Vérifier la demande">/);
  assert.match(xml, /<bpmn:exclusiveGateway id="d1"/);
  assert.match(xml, /<bpmn:timerEventDefinition id="w_def" \/>/);
  assert.match(xml, /name="J\+2 &lt;&amp; &quot;délai&quot;&gt;"/);
  assert.match(xml, /<bpmn:lane id="Lane_1" name="Client">\s*<bpmn:flowNodeRef>debut<\/bpmn:flowNodeRef>/);
  assert.match(xml, /<bpmn:sequenceFlow id="Flow_3" sourceRef="d1" targetRef="t2" name="non" \/>/);
  assert.match(xml, /<bpmn:documentation>Rôle : PO<\/bpmn:documentation>/);
  assert.equal((xml.match(/<bpmn:outgoing>/g) || []).length, 7);
});

test('makeBpmn: the layout draws every element and flow', async () => {
  const r = await makeBpmn('Traitement', structure);
  assert.equal(r.ok, true);
  assert.ok(hasDiagram(r.xml));
  assert.equal((r.xml.match(/<bpmndi:BPMNShape /g) || []).length, 6);
  assert.equal((r.xml.match(/<bpmndi:BPMNEdge /g) || []).length, 6);
  assert.deepEqual(r.counts, { elements: 6, flows: 6, lanes: 3 });
  assert.equal(r.structure.elements.length, 6);
  assert.equal(r.structure.flux[2].nom, 'non');
  const bad = await makeBpmn('x', { elements: [{ id: 'a', type: 'tache' }], flux: [] });
  assert.equal(bad.ok, false);
});

test('TYPE_NAMES stay French and stable (the tool enum and the guide quote them)', () => {
  assert.deepEqual(TYPE_NAMES, ['debut', 'fin', 'tache', 'utilisateur', 'service', 'manuel', 'script', 'envoi', 'reception', 'decision', 'parallele', 'inclusif', 'attente', 'message', 'evenement']);
});

test('formatDocList says the empty state and links each document', () => {
  const cfg = { appUrl: 'https://ndashiz.be/lazypo2/' };
  assert.match(formatDocList([], cfg, 'supabase'), /Aucun document/);
  const txt = formatDocList([{ id: 'abc', title: 'Onboarding', format: 'bpmn', meta: { counts: { elements: 6, flows: 6 } }, updated_at: '2026-10-15T10:00:00Z', where: 'supabase' }], cfg, 'supabase');
  assert.match(txt, /Onboarding — bpmn \(6 éléments, 6 flux\)/);
  assert.match(txt, /https:\/\/ndashiz\.be\/lazypo2\/depot\.html#abc/);
});
