#!/usr/bin/env node
'use strict';
// Periodic Codex rate-limit + optional weather panel for ND104.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { fetchQuotaRetry } = require('./lib/quota');
const { fetchWeatherRetry } = require('./lib/weather');
const { renderPanel, renderWeatherFrame, renderRainFrame } = require('./lib/render');
const { pushFrames, sleep } = require('./lib/nd104');

const has = option => process.argv.includes(option);
const val = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const DEMO = has('--demo');
const DRY = has('--dry-run') || DEMO;
const ONCE = has('--once') || DRY;
const FORCE = has('--force') || ONCE;
const SKIP_UNCHANGED = has('--skip-unchanged');
const INTERVAL_MIN = Math.max(1, Number(val('--interval', process.env.ND_INTERVAL_MIN || 30)) || 30);
const DWELL_SEC = Math.max(1, Number(val('--dwell', process.env.ND_DWELL_SEC || 6)) || 6);
const WEATHER = Boolean(process.env.CAIYUN_TOKEN) && !has('--no-weather') && !DEMO;
const ACTIVE_DAYS = process.env.ND_ACTIVE_DAYS ? process.env.ND_ACTIVE_DAYS.split(',').map(Number) : [1, 2, 3, 4, 5];
const ACTIVE_RANGES = process.env.ND_ACTIVE_RANGES
  ? process.env.ND_ACTIVE_RANGES.split(',').map(range => range.split('-').map(Number)).filter(a => a.length === 2)
  : [[9, 12], [14, 19]];
const UNIT_MS = 2000 / 255;
let lastQuota = null;
let lastWeather = null;
let lastHash = null;
const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

function active(now) {
  const date = new Date(now);
  const hour = date.getHours() + date.getMinutes() / 60;
  return ACTIVE_DAYS.includes(date.getDay()) && ACTIVE_RANGES.some(([start, end]) => hour >= start && hour < end);
}
function expandForDwell(frames, seconds) {
  const repeat = Math.max(1, Math.ceil((seconds * 1000) / 2000));
  const eachDelay = Math.min(255, Math.max(1, Math.round(seconds * 1000 / repeat / UNIT_MS)));
  const out = [], delays = [];
  for (const frame of frames) for (let i = 0; i < repeat; i++) {
    out.push(frame); delays.push(eachDelay);
  }
  return { frames: out, delays };
}
function demoQuota(now) {
  return {
    demo: true, status: 'allowed',
    fiveHour: { label: '5H', remainPct: 72, resetAt: now + 78 * 60000 },
    weekly: { label: '1W', remainPct: 41, resetAt: now + 3 * 86400000 },
  };
}
async function buildFrameSet(now) {
  const [qr, wr] = await Promise.allSettled([
    DEMO ? Promise.resolve(demoQuota(now)) : fetchQuotaRetry(),
    WEATHER ? fetchWeatherRetry() : Promise.resolve(null),
  ]);
  const notes = [];
  let quota = null, weather = null;
  if (qr.status === 'fulfilled') { quota = qr.value; quota.at = now; lastQuota = quota; }
  else { notes.push('Codex: ' + qr.reason.message); quota = lastQuota; }
  if (wr.status === 'fulfilled' && wr.value) { weather = wr.value; weather.at = now; lastWeather = weather; }
  else if (wr.status === 'rejected') { notes.push('Weather: ' + wr.reason.message); weather = lastWeather; }
  const frames = [];
  if (quota) frames.push(await renderPanel(quota, now));
  if (weather) {
    frames.push(await renderWeatherFrame(weather, now));
    if (weather.rain && weather.rain.soon) frames.push(await renderRainFrame(weather, now));
  }
  // Exclude the clock/current fetch timestamp so skip-unchanged actually works.
  const fingerprint = JSON.stringify({
    q: quota && { status: quota.status, fiveHour: quota.fiveHour, weekly: quota.weekly },
    w: weather && { ...weather, at: undefined },
  });
  const info = 'Codex 5H ' + (quota?.fiveHour?.remainPct ?? '--') +
    '% / weekly ' + (quota?.weekly?.remainPct ?? '--') + '%; frames=' + frames.length +
    (notes.length ? '; ' + notes.join('; ') : '');
  return { frames, info, fingerprint };
}
async function cycle() {
  const now = Date.now();
  if (!FORCE && !active(now)) { console.log('[' + stamp() + '] outside active hours; skipped'); return; }
  let set;
  try { set = await buildFrameSet(now); }
  catch (error) { console.error('[' + stamp() + '] render failed: ' + error.message); if (ONCE) process.exitCode = 1; return; }
  const { frames, info, fingerprint } = set;
  if (!frames.length) { console.error('[' + stamp() + '] no data: ' + info); if (ONCE) process.exitCode = 1; return; }
  if (DRY) {
    for (let i = 0; i < frames.length; i++) fs.writeFileSync('panel-' + (i + 1) + '.jpg', frames[i]);
    console.log('[' + stamp() + '] preview written: panel-1.jpg ... panel-' + frames.length + '.jpg; ' + info);
    return;
  }
  const hash = crypto.createHash('sha256').update(fingerprint).digest('hex');
  if (SKIP_UNCHANGED && hash === lastHash) { console.log('[' + stamp() + '] unchanged; skipped'); return; }
  try {
    const expanded = expandForDwell(frames, DWELL_SEC);
    const result = await pushFrames(expanded.frames, { delay: expanded.delays });
    if (!result.ok) throw new Error('device returned unsuccessful acknowledgement');
    lastHash = hash;
    console.log('[' + stamp() + '] uploaded (' + result.ms + ' ms): ' + info);
  } catch (error) {
    console.error('[' + stamp() + '] HID upload failed: ' + error.message);
    if (ONCE) process.exitCode = 1;
  }
}
async function main() {
  console.log('ND104 Codex panel: interval=' + INTERVAL_MIN + 'm, weather=' + WEATHER + ', dry=' + DRY + ', demo=' + DEMO);
  for (;;) {
    const started = Date.now();
    await cycle();
    if (ONCE) break;
    await sleep(Math.max(1000, INTERVAL_MIN * 60000 - (Date.now() - started)));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });