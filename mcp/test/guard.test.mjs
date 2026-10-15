import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCidr, ipInRanges, isLoopback, clientInfo, tokenPresented, hostAllowed, loopbackHosts, RateLimiter, guardMcp, isLocalFace, localWriteAllowed, normaliseIp } from '../lib/guard.mjs';

const TOKEN = 'a'.repeat(43);
const cfg = { token: TOKEN, port: 8787, provenance: 'anthropic', publicHosts: ['lazypo-mcp.ndashiz.be'], rateLimitPerMinute: 3 };
const RANGES = ['160.79.104.0/21'];
const req = (headers = {}, remote = '127.0.0.1') => ({ headers, socket: { remoteAddress: remote }, method: 'POST' });

test('CIDR: Anthropic range, edges and outsiders', () => {
  assert.deepEqual(parseCidr('160.79.104.0/21'), { base: ((160 * 256 + 79) * 256 + 104) * 256, mask: 0xFFFFF800 });
  assert.ok(ipInRanges('160.79.104.1', RANGES));
  assert.ok(ipInRanges('160.79.111.254', RANGES));
  assert.ok(!ipInRanges('160.79.112.1', RANGES));
  assert.ok(!ipInRanges('160.79.103.255', RANGES));
  assert.ok(ipInRanges('::ffff:160.79.105.9', RANGES), 'mapped IPv4');
  assert.ok(!ipInRanges('2607:6bc0::1', RANGES), 'no outbound v6 range published');
  assert.throws(() => parseCidr('999.1.1.1/8'));
});

test('loopback detection', () => {
  assert.ok(isLoopback('127.0.0.1')); assert.ok(isLoopback('::1')); assert.ok(isLoopback('::ffff:127.0.0.1'));
  assert.ok(!isLoopback('10.0.0.1')); assert.equal(normaliseIp('[::1]'), '::1');
});

test('client address: cloudflared, x-forwarded-for, plain socket', () => {
  assert.deepEqual(clientInfo(req({ 'cf-connecting-ip': '160.79.104.5' })), { ip: '160.79.104.5', viaProxy: true, socket: '127.0.0.1' });
  assert.deepEqual(clientInfo(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), { ip: '1.2.3.4', viaProxy: true, socket: '127.0.0.1' });
  assert.deepEqual(clientInfo(req({})), { ip: '127.0.0.1', viaProxy: false, socket: '127.0.0.1' });
});

test('token: any header, raw or Bearer, constant-time equal', () => {
  assert.ok(tokenPresented(req({ authorization: `Bearer ${TOKEN}` }), TOKEN));
  assert.ok(tokenPresented(req({ 'x-api-key': TOKEN }), TOKEN));
  assert.ok(tokenPresented(req({ 'x-auth-token': `bearer ${TOKEN}` }), TOKEN));
  assert.ok(!tokenPresented(req({ authorization: `Bearer ${TOKEN.slice(0, -1)}b` }), TOKEN));
  assert.ok(!tokenPresented(req({ authorization: 'Bearer ' }), TOKEN));
  assert.ok(!tokenPresented(req({ host: TOKEN }), TOKEN), 'Host is never a credential');
  assert.ok(!tokenPresented(req({}), ''), 'empty token never matches');
});

test('Host: loopback forms and configured public hosts only', () => {
  const allowed = loopbackHosts(8787).concat(cfg.publicHosts);
  assert.ok(hostAllowed(req({ host: '127.0.0.1:8787' }), allowed));
  assert.ok(hostAllowed(req({ host: 'LOCALHOST:8787' }), allowed));
  assert.ok(hostAllowed(req({ host: 'lazypo-mcp.ndashiz.be' }), allowed));
  assert.ok(!hostAllowed(req({ host: '127.0.0.1:9999' }), allowed));
  assert.ok(!hostAllowed(req({ host: 'evil.example' }), allowed));
  assert.ok(!hostAllowed(req({}), allowed));
});

test('rate limiter: fixed window per key', () => {
  let t = 0; const rl = new RateLimiter(2, () => t);
  assert.ok(rl.allow('a')); assert.ok(rl.allow('a')); assert.ok(!rl.allow('a'));
  assert.ok(rl.allow('b'));
  t = 60001; assert.ok(rl.allow('a'));
});

test('guardMcp: order and refusals', () => {
  const ok = () => new RateLimiter(3);
  const good = { host: '127.0.0.1:8787', 'cf-connecting-ip': '160.79.104.9', authorization: `Bearer ${TOKEN}` };
  assert.equal(guardMcp(req(good), cfg, ok(), RANGES).ok, true);
  assert.equal(guardMcp(req({ ...good, 'cf-connecting-ip': '8.8.8.8' }), cfg, ok(), RANGES).reason, 'provenance');
  assert.equal(guardMcp(req({ ...good, authorization: 'Bearer nope' }), cfg, ok(), RANGES).reason, 'token');
  assert.equal(guardMcp(req({ ...good, host: 'other:8787' }), cfg, ok(), RANGES).reason, 'host');
  // Local test call: no proxy header, loopback socket → provenance passes
  assert.equal(guardMcp(req({ host: 'localhost:8787', authorization: TOKEN }), cfg, ok(), RANGES).ok, true);
  // LAN caller without tunnel header → refused
  assert.equal(guardMcp(req({ host: '127.0.0.1:8787', authorization: TOKEN }, '192.168.1.20'), cfg, ok(), RANGES).reason, 'provenance');
  // provenance 'any' only drops control a
  assert.equal(guardMcp(req({ ...good, 'cf-connecting-ip': '8.8.8.8' }), { ...cfg, provenance: 'any' }, ok(), RANGES).ok, true);
  // ceiling
  const rl = ok(); for (let i = 0; i < 3; i++) guardMcp(req(good), cfg, rl, RANGES);
  assert.equal(guardMcp(req(good), cfg, rl, RANGES).reason, 'rate');
});

test('local face: loopback browser only, writes need JSON from our origin', () => {
  assert.ok(isLocalFace(req({ host: 'localhost:8787' }), 8787));
  assert.ok(!isLocalFace(req({ host: 'localhost:8787', 'cf-connecting-ip': '160.79.104.9' }), 8787), 'through the tunnel: no face');
  assert.ok(!isLocalFace(req({ host: 'localhost:8787' }, '192.168.1.5'), 8787));
  assert.ok(!isLocalFace(req({ host: 'lazypo-mcp.ndashiz.be' }), 8787), 'public host never serves the face');
  assert.ok(localWriteAllowed(req({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:8787' }), 8787));
  assert.ok(!localWriteAllowed(req({ 'content-type': 'application/x-www-form-urlencoded' }), 8787), 'a cross-origin form');
  assert.ok(!localWriteAllowed(req({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }), 8787));
  assert.ok(!localWriteAllowed(req({ 'content-type': 'application/json', origin: 'http://evil.example' }), 8787));
});
