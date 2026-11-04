'use strict';
/*
 * lib/icons.js —— 纯 SVG 矢量天气图标(无外部资源,供 sharp 渲染)。
 * weatherIcon(key, {x, y, size, color}) → 一段 <g>,在 100×100 基准坐标里绘制后整体缩放平移。
 * key 与 lib/weather.js:SKYCON.icon 对应。
 */

const CLOUD = '#c9d1d9';   // 云-浅灰
const CLOUD_DK = '#8b949e'; // 阴云-深灰
const RAIN = '#58a6ff';    // 雨-蓝
const SNOWC = '#a5d8ff';   // 雪-淡蓝
const BOLT = '#f2c94c';    // 闪电-黄

const round = (n) => (Math.round(n * 10) / 10);

// —— 基础元件(均在 100×100 坐标) ——
function sun(cx, cy, r, fill) {
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const x1 = cx + Math.cos(a) * (r + 5), y1 = cy + Math.sin(a) * (r + 5);
    const x2 = cx + Math.cos(a) * (r + 14), y2 = cy + Math.sin(a) * (r + 14);
    rays += `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${fill}" stroke-width="5" stroke-linecap="round"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>${rays}`;
}
function moon(cx, cy, r, fill) {
  return `<path d="M ${round(cx + r * 0.35)},${round(cy - r)} a ${r},${r} 0 1,0 0,${2 * r} a ${round(r * 0.8)},${round(r * 0.8)} 0 1,1 0,${round(-2 * r)} z" fill="${fill}"/>`;
}
function cloud(fill, dx = 0, dy = 0) {
  return `<g fill="${fill}" transform="translate(${dx},${dy})">
    <ellipse cx="38" cy="62" rx="19" ry="17"/>
    <ellipse cx="61" cy="57" rx="24" ry="22"/>
    <ellipse cx="72" cy="66" rx="15" ry="14"/>
    <rect x="26" y="63" width="53" height="17" rx="8.5"/></g>`;
}
function rainLines(color, n) {
  const xs = [40, 55, 70];
  let s = '';
  for (let i = 0; i < n; i++) s += `<line x1="${xs[i]}" y1="84" x2="${xs[i] - 6}" y2="97" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
  return s;
}
function snowDots(color) {
  return [40, 55, 70].map(x => `<circle cx="${x}" cy="90" r="4" fill="${color}"/>`).join('');
}
function bolt() {
  return `<path d="M58,80 L44,98 L54,98 L48,112" fill="none" stroke="${BOLT}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
}
function hLines(color) {
  return [70, 80, 90].map((y, i) => `<line x1="${28 + (i % 2) * 6}" y1="${y}" x2="${80 - (i % 2) * 6}" y2="${y}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`).join('');
}

// —— 组合图标 ——
const ICONS = {
  'clear-day':     (c) => sun(50, 50, 22, c),
  'clear-night':   (c) => moon(54, 50, 24, c),
  'pcloudy-day':   (c) => sun(36, 36, 15, '#f2a93b') + cloud(CLOUD, 6, 6),
  'pcloudy-night': (c) => moon(38, 34, 16, '#c9d1d9') + cloud(CLOUD_DK, 6, 6),
  'cloudy':        () => cloud(CLOUD_DK, -6, -2) + cloud(CLOUD, 8, 6),
  'rain':          (c) => cloud(CLOUD_DK) + rainLines(c || RAIN, 3),
  'heavy-rain':    (c) => cloud(CLOUD_DK) + rainLines(c || RAIN, 3) + `<line x1="48" y1="86" x2="42" y2="99" stroke="${c || RAIN}" stroke-width="5" stroke-linecap="round"/>`,
  'storm':         () => cloud(CLOUD_DK) + bolt(),
  'snow':          (c) => cloud(CLOUD_DK) + snowDots(c || SNOWC),
  'fog':           () => cloud(CLOUD_DK, 0, -8) + hLines('#a0aab3'),
  'haze':          () => sun(50, 44, 16, '#c9a227') + hLines('#c9a227'),
  'dust':          () => hLines('#c98a27') + `<circle cx="50" cy="52" r="14" fill="#c98a27" opacity="0.7"/>`,
  'wind':          (c) => [46, 58, 70].map((y, i) => `<path d="M22,${y} h${34 + i * 6} a7,7 0 1,0 -7,-7" fill="none" stroke="${c || '#79c0ff'}" stroke-width="5" stroke-linecap="round"/>`).join(''),
};

function weatherIcon(key, { x = 0, y = 0, size = 64, color = null } = {}) {
  const draw = ICONS[key] || ICONS.cloudy;
  const s = size / 100;
  return `<g transform="translate(${x},${y}) scale(${round(s)})">${draw(color)}</g>`;
}

// 大号"降雨提醒"图标: 一滴大雨滴 + 内部感叹号。
function rainDrop({ x = 0, y = 0, size = 64, color = '#58a6ff' } = {}) {
  const s = size / 100;
  const drop = `<path d="M50,8 C50,8 84,52 84,70 a34,34 0 0,1 -68,0 C16,52 50,8 50,8 Z" fill="${color}"/>`;
  const bang = `<rect x="46" y="46" width="8" height="24" rx="4" fill="#0d1117"/><circle cx="50" cy="80" r="5" fill="#0d1117"/>`;
  return `<g transform="translate(${x},${y}) scale(${round(s)})">${drop}${bang}</g>`;
}

module.exports = { weatherIcon, rainDrop, ICONS };
