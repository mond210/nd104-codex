'use strict';
// Codex usage via the documented app-server JSONL protocol.
// No access tokens are read by this integration, and no model inference is made.
const { spawn } = require('node:child_process');

function normalizeWindow(window, fallback) {
  if (!window || typeof window !== 'object') return { label: fallback, remainPct: null, resetAt: null };
  const used = typeof window.usedPercent === 'number' && Number.isFinite(window.usedPercent)
    ? Math.max(0, Math.min(100, window.usedPercent)) : null;
  const mins = window.windowDurationMins;
  let label = fallback;
  if (typeof mins === 'number' && Number.isFinite(mins) && mins > 0) {
    if (mins % 10080 === 0) label = (mins / 10080) + 'W';
    else if (mins % 1440 === 0) label = (mins / 1440) + 'D';
    else if (mins % 60 === 0) label = (mins / 60) + 'H';
    else label = mins + 'M';
  }
  const resetAt = typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) && window.resetsAt > 0
    ? window.resetsAt * 1000 : null;
  return { label, remainPct: used === null ? null : Math.round(100 - used), resetAt };
}

function normalizeRateLimits(result, bucketId = process.env.CODEX_LIMIT_ID || 'codex') {
  if (!result || typeof result !== 'object') throw new Error('Empty Codex rate-limit response');
  const byId = result.rateLimitsByLimitId;
  if (byId && Object.keys(byId).length > 0 && !byId[bucketId]) {
    throw new Error('Codex rate-limit bucket not found: ' + bucketId + ' (available: ' + Object.keys(byId).join(', ') + ')');
  }
  const raw = byId?.[bucketId] || result.rateLimits;
  if (!raw || (!raw.primary && !raw.secondary)) throw new Error('Codex rate-limit windows unavailable. Check ChatGPT login; API-key-only auth does not expose subscription quota.');
  const blocked = result.ordinaryUsageAllowed === false || Boolean(raw.rateLimitReachedType) || raw.spendControlReached === true;
  return {
    bucketId: raw.limitId || bucketId,
    planType: raw.planType || null,
    status: blocked ? 'blocked' : result.ordinaryUsageAllowed === true ? 'allowed' : 'unknown',
    fiveHour: normalizeWindow(raw.primary, 'PRIMARY'),
    weekly: normalizeWindow(raw.secondary, 'SECONDARY'),
    at: Date.now(),
  };
}

function fetchQuota({ bin = process.env.CODEX_BIN || 'codex', timeoutMs = 30000, spawnFn = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(bin, ['app-server', '--listen', 'stdio://'], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        shell: process.platform === 'win32',
      });
    } catch (error) { reject(error); return; }

    let settled = false;
    let buffer = '';
    let stderr = '';
    const timeout = setTimeout(() => finish(new Error('Codex app-server timeout after ' + timeoutMs + ' ms')), timeoutMs);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { child.stdin.end(); } catch (_) { /* no-op */ }
      try { child.kill(); } catch (_) { /* no-op */ }
      if (error) reject(error);
      else resolve(value);
    }
    function send(message) {
      if (settled) return;
      try { child.stdin.write(JSON.stringify(message) + '\n'); }
      catch (error) { finish(error); }
    }
    function onMessage(message) {
      if (message.id === 1) {
        if (message.error) return finish(new Error('Codex initialize: ' + (message.error.message || JSON.stringify(message.error))));
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'account/rateLimits/read', params: {} });
      } else if (message.id === 2) {
        if (message.error) return finish(new Error('Codex rate limits: ' + (message.error.message || JSON.stringify(message.error))));
        try { finish(null, normalizeRateLimits(message.result)); }
        catch (error) { finish(error); }
      }
    }
    child.on('error', error => finish(error.code === 'ENOENT'
      ? new Error('Codex CLI not found. Install @openai/codex, run codex login, and check CODEX_BIN/PATH.') : error));
    child.on('close', (code, signal) => {
      if (!settled) finish(new Error('Codex app-server exited (' + (code ?? signal ?? '?') + '): ' + stderr.slice(-300)));
    });
    child.stdin.on('error', error => finish(error));
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-1000); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 2_000_000) return finish(new Error('Codex response exceeded 2MB'));
      while (!settled) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        try { onMessage(JSON.parse(line)); }
        catch (error) { finish(new Error('Invalid JSONL from Codex: ' + error.message)); }
      }
    });
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'nd104_codex', title: 'ND104 Codex Panel', version: '0.1.0' },
    } });
  });
}

async function fetchQuotaRetry(tries = 2, delayMs = 1200) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fetchQuota(); }
    catch (error) {
      last = error;
      if (/not found|not logged|not initialized|auth|login|bucket/.test(error.message.toLowerCase())) break;
      if (i < tries - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw last;
}

module.exports = { normalizeWindow, normalizeRateLimits, fetchQuota, fetchQuotaRetry };