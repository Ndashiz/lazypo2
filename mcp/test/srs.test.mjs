import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrs, loadLazyPI } from '../lib/srs.mjs';

test('the SRS block of quiz.html loads under Node and behaves', () => {
  const srs = loadSrs();
  assert.equal(typeof srs.srsNext, 'function');
  assert.equal(typeof srs.srsComposeDaily, 'function');
  const now = Date.parse('2026-10-15T10:00:00Z');
  const first = srs.srsNext(null, srs.GRADE.GOOD, now);
  assert.equal(first.state.stage, 'learn');
  assert.equal(first.state.interval_days, 1);
  assert.equal(first.log.stage, 'new');
  const easy = srs.srsNext(null, srs.GRADE.EASY, now);
  assert.equal(easy.state.stage, 'recv');
  assert.equal(easy.state.interval_days, 3);
});

test('pi.js loads with inert shims and keeps the inclusive end', () => {
  const LazyPI = loadLazyPI();
  const pi = LazyPI.normalise({ name: 'PI test', start: '2026-10-01', end: '2026-11-25', sprintLen: 14, releases: [{ name: 'R1', date: '2026-11-05' }] });
  const sprints = LazyPI.buildSprints(pi);
  assert.equal(sprints.length, 4);
  assert.equal(LazyPI.isoD(sprints[3].endInclusive), '2026-11-25');
  assert.equal(LazyPI.isoD(sprints[3].end), '2026-11-26', 'end is exclusive');
  const c = LazyPI.cockpit(pi);
  assert.equal(c.hasPI, true);
  assert.equal(c.sprintCount, 4);
});
