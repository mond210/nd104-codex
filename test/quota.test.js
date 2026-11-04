'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { normalizeRateLimits, fetchQuota } = require('../lib/quota');
const sample = {
  ordinaryUsageAllowed: true,
  rateLimits: { primary: { usedPercent: 90, windowDurationMins: 300 } },
  rateLimitsByLimitId: { codex: {
    limitId: 'codex', primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 1780000000 },
    secondary: { usedPercent: 18, windowDurationMins: 10080, resetsAt: 1780200000 },
  } },
};

test('uses the codex bucket; reports remaining rather than used percent', () => {
  const q = normalizeRateLimits(sample);
  assert.equal(q.fiveHour.remainPct, 63);
  assert.equal(q.fiveHour.label, '5H');
  assert.equal(q.weekly.remainPct, 82);
  assert.equal(q.weekly.label, '1W');
  assert.equal(q.fiveHour.resetAt, 1780000000000);
  assert.equal(q.status, 'allowed');
});
test('does not assume missing limits mean 100% available', () => {
  const q = normalizeRateLimits({ rateLimits: { primary: { usedPercent: 40, windowDurationMins: 15 } } });
  assert.equal(q.fiveHour.label, '15M');
  assert.equal(q.weekly.remainPct, null);
  assert.equal(q.status, 'unknown');
});
test('recognizes server-reported blocking status', () => {
  const q = normalizeRateLimits({ ...sample, ordinaryUsageAllowed: false });
  assert.equal(q.status, 'blocked');
});
test('requires a valid quota window', () => {
  assert.throws(() => normalizeRateLimits({rateLimits: {primary: null, secondary: null}}), /unavailable/);
});
test('performs initialize / initialized / rateLimits read in order', async () => {
  const requests = [];
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.stdin.on('data', chunk => {
      for (const line of chunk.toString('utf8').split('\n').filter(Boolean)) {
        const req = JSON.parse(line);
        requests.push(req);
        if (req.method === 'initialize') queueMicrotask(() => child.stdout.write('{"id":1,"result":{}}\n'));
        if (req.method === 'account/rateLimits/read') {
          const reply = JSON.stringify({ id: 2, result: sample }) + '\n';
          queueMicrotask(() => { child.stdout.write(reply.slice(0, 12)); child.stdout.write(reply.slice(12)); });
        }
      }
    });
    return child;
  };
  const q = await fetchQuota({spawnFn:fakeSpawn,timeoutMs:1000});
  assert.equal(q.fiveHour.remainPct,63);
  assert.deepEqual(requests.map(r=>r.method), ['initialize','initialized','account/rateLimits/read']);
});