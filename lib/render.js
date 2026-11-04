'use strict';
/*
 * lib/render.js —— 把真实额度渲染成 320x172 的 JPEG。
 * 只显示两个大数字: 5H 剩余额度% 和 周剩余额度%(+ 重置倒计时)。
 * 走 SVG → sharp,并注入 JFIF 头贴近官方(设备解码器需要)。
 */
const sharp = require('sharp');
const { SCREEN_W: W, SCREEN_H: H } = require('./nd104');
const { weatherIcon, rainDrop } = require('./icons');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtReset(ms) {
  if (ms == null || !isFinite(ms) || ms <= 0) return '—';
  const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(mm).padStart(2, '0')}m`;
  return `${mm}m`;
}
function colorFor(pct) {
  if (pct == null) return '#8b949e';
  if (pct >= 50) return '#3fb950';   // 充足-绿
  if (pct >= 20) return '#d29922';   // 偏少-黄
  return '#f85149';                  // 告急-红
}

// 单个额度区块(标签 + 大百分比 + 重置 + 剩余条)
function section(label, pct, resetMs, yTop) {
  const c = colorFor(pct);
  const barX = 16, barW = W - 32, barY = yTop + 52, barH = 7;
  const fillW = pct == null ? 0 : Math.max(2, Math.round(barW * pct / 100));
  const val = pct == null ? '--' : pct + '%';
  return `
  <text x="16" y="${yTop + 15}" font-family="Helvetica,Arial,sans-serif" font-size="14" fill="#8b949e" letter-spacing="1">${esc(label)}</text>
  <text x="${W - 16}" y="${yTop + 15}" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="13" fill="#8b949e">RESET ${esc(fmtReset(resetMs))}</text>
  <text x="14" y="${yTop + 46}" font-family="Helvetica,Arial,sans-serif" font-size="40" font-weight="800" fill="${c}">${val}</text>
  <text x="${W - 16}" y="${yTop + 46}" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="13" fill="#6e7681">LEFT</text>
  <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="3.5" fill="#21262d"/>
  <rect x="${barX}" y="${barY}" width="${fillW}" height="${barH}" rx="3.5" fill="${c}"/>`;
}

function buildSvg(q, now) {
  const dot = !q ? '#8b949e' : q.status === 'allowed' ? '#3fb950' : q.status === 'blocked' ? '#f85149' : '#8b949e';
  const clock = new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const fh = (q && q.fiveHour) || {}, wk = (q && q.weekly) || {};
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0d1117"/>
  <rect x="0" y="0" width="${W}" height="26" fill="#161b22"/>
  <text x="16" y="18" font-family="Helvetica,Arial,sans-serif" font-size="13" font-weight="700" fill="#e6edf3" letter-spacing="1.5">CODEX</text>
  <circle cx="${W - 52}" cy="13" r="4" fill="${dot}"/>
  <text x="${W - 44}" y="18" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#8b949e">${esc(clock)}</text>
  ${section((fh.label || '5H') + ' LIMIT', fh.remainPct, fh.resetAt == null ? null : fh.resetAt - now, 31)}
  <line x1="16" y1="102" x2="${W - 16}" y2="102" stroke="#21262d" stroke-width="1"/>
  ${section((wk.label || 'WEEKLY') + ' LIMIT', wk.remainPct, wk.resetAt == null ? null : wk.resetAt - now, 110)}
</svg>`;
}

// —— 共享: 顶栏时钟 ——
function clockStr(now) {
  return new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
// CJK 粗略按字宽截断(避免底部提示条溢出)。
function clip(s, maxPx, px) {
  s = String(s || '');
  const per = px * 0.92, max = Math.floor(maxPx / per);
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s;
}

// —— 天气帧 ——
function buildWeatherSvg(w, now) {
  const c = w.color || '#6cb6ff';
  const aq = w.aqiLevel || {};
  const icon = weatherIcon(w.icon, { x: 206, y: 22, size: 86, color: c });
  const hilo = `${w.hi == null ? '' : '↑' + w.hi + '°'}  ${w.lo == null ? '' : '↓' + w.lo + '°'}`.trim();
  const wind = w.wind ? `${w.wind.dir}风 ${w.wind.level}级` : '';
  const pillC = aq.color || '#8b949e';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0d1117"/>
  <rect x="0" y="0" width="${W}" height="26" fill="#161b22"/>
  <text x="16" y="18" font-family="Helvetica,Arial,sans-serif" font-size="15" font-weight="700" fill="#e6edf3" letter-spacing="1">${esc(w.city)}</text>
  <rect x="196" y="5" width="78" height="16" rx="8" fill="${pillC}" fill-opacity="0.18"/>
  <text x="235" y="17" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="11" font-weight="700" fill="${pillC}">AQI ${w.aqi == null ? '--' : w.aqi} ${esc(aq.label || '')}</text>
  <text x="${W - 14}" y="18" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#8b949e">${esc(clockStr(now))}</text>
  ${icon}
  <text x="14" y="108" font-family="Helvetica,Arial,sans-serif" font-size="62" font-weight="800" fill="#f0f6fc">${w.tempNow == null ? '--' : w.tempNow}°</text>
  <text x="150" y="74" font-family="Helvetica,Arial,sans-serif" font-size="24" font-weight="700" fill="${c}">${esc(w.skyLabel)}</text>
  <text x="151" y="99" font-family="Helvetica,Arial,sans-serif" font-size="13" fill="#8b949e">体感 ${w.feels == null ? '--' : w.feels}°</text>
  <text x="16" y="134" font-family="Helvetica,Arial,sans-serif" font-size="15" fill="#c9d1d9">${esc(hilo)}</text>
  <text x="${W / 2 + 8}" y="134" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="14" fill="#8b949e">湿度 ${w.humidity == null ? '--' : w.humidity}%</text>
  <text x="${W - 16}" y="134" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="14" fill="#8b949e">${esc(wind)}</text>
  <rect x="0" y="146" width="${W}" height="26" fill="#161b22"/>
  <text x="16" y="163" font-family="Helvetica,Arial,sans-serif" font-size="13" fill="#8b949e">${esc(clip(w.keypoint, W - 28, 13))}</text>
</svg>`;
}

// —— 降雨预警帧 ——
function buildRainSvg(w, now) {
  const r = w.rain || {};
  const rainC = w.color && /RAIN|SNOW/.test(w.skycon) ? w.color : '#58a6ff';
  const title = r.now ? `正在下${esc(r.level || '雨')}` : `未来2小时有${esc(r.snow ? '雪' : '雨')}`;
  const sub = r.now
    ? `${esc(r.level || '')}${r.prob == null ? '' : ' · 概率 ' + r.prob + '%'}`
    : `约 ${esc(r.atHour || '')} 转${esc(r.level || '雨')}${r.prob == null ? '' : ' · 概率 ' + r.prob + '%'}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0d1117"/>
  <rect x="0" y="0" width="${W}" height="26" fill="#161b22"/>
  <rect x="0" y="0" width="4" height="${H}" fill="#d29922"/>
  <text x="16" y="18" font-family="Helvetica,Arial,sans-serif" font-size="14" font-weight="700" fill="#d29922" letter-spacing="2">降 雨 提 醒</text>
  <text x="${W - 14}" y="18" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#8b949e">${esc(clockStr(now))}</text>
  ${rainDrop({ x: 26, y: 44, size: 92, color: rainC })}
  <text x="140" y="86" font-family="Helvetica,Arial,sans-serif" font-size="26" font-weight="800" fill="#f0f6fc">${title}</text>
  <text x="140" y="116" font-family="Helvetica,Arial,sans-serif" font-size="15" fill="${rainC}">${sub}</text>
  <text x="140" y="140" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#6e7681">${esc(w.city)} · 记得带伞</text>
  <rect x="0" y="146" width="${W}" height="26" fill="#161b22"/>
  <text x="16" y="163" font-family="Helvetica,Arial,sans-serif" font-size="13" fill="#8b949e">${esc(clip(w.keypoint, W - 28, 13))}</text>
</svg>`;
}

function ensureJfif(jpg) {
  if (!(jpg[0] === 0xff && jpg[1] === 0xd8)) return jpg;
  if (jpg[2] === 0xff && jpg[3] === 0xe0) return jpg;
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return Buffer.concat([jpg.subarray(0, 2), app0, jpg.subarray(2)]);
}

async function svgToJpeg(svg) {
  const jpg = await sharp(Buffer.from(svg))
    .resize(W, H).jpeg({ quality: 88, chromaSubsampling: '4:2:0', progressive: false, optimizeCoding: false }).toBuffer();
  return ensureJfif(jpg);
}
// 调试用: 直出 PNG(dry-run 预览,肉眼审版)。
function svgToPng(svg) { return sharp(Buffer.from(svg)).resize(W, H).png().toBuffer(); }

async function renderPanel(q, now) { return svgToJpeg(buildSvg(q, now)); }
async function renderWeatherFrame(w, now) { return svgToJpeg(buildWeatherSvg(w, now)); }
async function renderRainFrame(w, now) { return svgToJpeg(buildRainSvg(w, now)); }

module.exports = {
  renderPanel, renderWeatherFrame, renderRainFrame,
  buildSvg, buildWeatherSvg, buildRainSvg, svgToJpeg, svgToPng, fmtReset,
};
