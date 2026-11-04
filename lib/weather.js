'use strict';
/*
 * lib/weather.js —— 彩云天气取数 + 归一化 + "2 小时内降雨"检测。
 * 数据源: 彩云综合接口
 *   GET https://api.caiyunapp.com/v2.6/<token>/<lng>,<lat>/weather?dailysteps=3&hourlysteps=48
 * 配置全部走 env: CAIYUN_TOKEN(必填, 去 dashboard.caiyunapp.com 免费申请)/
 *   WEATHER_COORD("lng,lat")/ WEATHER_CITY。normalize() 单独导出, 便于离线测试。
 */
const https = require('https');

const TOKEN = process.env.CAIYUN_TOKEN || '';                        // 必填, 见 README
const COORD = process.env.WEATHER_COORD || '116.4074,39.9042';       // 默认北京, 用 env 覆盖
const CITY  = process.env.WEATHER_CITY  || '北京';
const RAIN_PROB = +process.env.RAIN_PROB || 30;

// skycon → 中文标签 + 图标 key(见 lib/icons.js)+ 主色
const SKYCON = {
  CLEAR_DAY:           { label: '晴',     icon: 'clear-day',    color: '#f2a93b' },
  CLEAR_NIGHT:         { label: '晴',     icon: 'clear-night',  color: '#a9b4c2' },
  PARTLY_CLOUDY_DAY:   { label: '多云',   icon: 'pcloudy-day',  color: '#6cb6ff' },
  PARTLY_CLOUDY_NIGHT: { label: '多云',   icon: 'pcloudy-night',color: '#8b98a5' },
  CLOUDY:              { label: '阴',     icon: 'cloudy',       color: '#8b949e' },
  LIGHT_HAZE:          { label: '轻度霾', icon: 'haze',         color: '#c9a227' },
  MODERATE_HAZE:       { label: '中度霾', icon: 'haze',         color: '#b8860b' },
  HEAVY_HAZE:          { label: '重度霾', icon: 'haze',         color: '#a1682a' },
  LIGHT_RAIN:          { label: '小雨',   icon: 'rain',         color: '#58a6ff' },
  MODERATE_RAIN:       { label: '中雨',   icon: 'rain',         color: '#4894ef' },
  HEAVY_RAIN:          { label: '大雨',   icon: 'heavy-rain',   color: '#3b7dd8' },
  STORM_RAIN:          { label: '暴雨',   icon: 'storm',        color: '#8a7dff' },
  FOG:                 { label: '雾',     icon: 'fog',          color: '#a0aab3' },
  LIGHT_SNOW:          { label: '小雪',   icon: 'snow',         color: '#a5d8ff' },
  MODERATE_SNOW:       { label: '中雪',   icon: 'snow',         color: '#8ecbff' },
  HEAVY_SNOW:          { label: '大雪',   icon: 'snow',         color: '#79bbff' },
  STORM_SNOW:          { label: '暴雪',   icon: 'snow',         color: '#6cb0ff' },
  DUST:                { label: '浮尘',   icon: 'dust',         color: '#c9a227' },
  SAND:                { label: '沙尘',   icon: 'dust',         color: '#c98a27' },
  WIND:                { label: '大风',   icon: 'wind',         color: '#79c0ff' },
};

// 中国 AQI 分级(realtime.air_quality.aqi.chn)
function aqiLevel(aqi) {
  if (aqi == null) return { label: '--', color: '#8b949e' };
  if (aqi <= 50)  return { label: '优',   color: '#3fb950' };
  if (aqi <= 100) return { label: '良',   color: '#d29922' };
  if (aqi <= 150) return { label: '轻度', color: '#f0883e' };
  if (aqi <= 200) return { label: '中度', color: '#f85149' };
  if (aqi <= 300) return { label: '重度', color: '#bc4be0' };
  return { label: '严重', color: '#a01a3a' };
}

const WIND_DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
function windText(deg, kmh) {
  const dir = WIND_DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  const ms = (kmh || 0) / 3.6;
  const beaufort = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  let level = 0; for (const b of beaufort) { if (ms >= b) level++; else break; }
  return { dir, level, kmh: Math.round(kmh || 0) };
}

// 从 skycon / 降水量推断雨(雪)量级中文
function rainLevel(skycon, precip) {
  if (/LIGHT_RAIN/.test(skycon)) return '小雨';
  if (/MODERATE_RAIN/.test(skycon)) return '中雨';
  if (/HEAVY_RAIN/.test(skycon)) return '大雨';
  if (/STORM_RAIN/.test(skycon)) return '暴雨';
  if (/LIGHT_SNOW/.test(skycon)) return '小雪';
  if (/MODERATE_SNOW/.test(skycon)) return '中雪';
  if (/HEAVY_SNOW/.test(skycon)) return '大雪';
  if (/STORM_SNOW/.test(skycon)) return '暴雪';
  const v = precip ? precip.value : 0;                 // 概率触发但 skycon 非雨时按降水量估
  if (v >= 0.48) return '暴雨';
  if (v >= 0.35) return '大雨';
  if (v >= 0.25) return '中雨';
  return '小雨';
}

// 未来 2 小时内(hourly[0..2])是否可能降雨/雪。命中返回首个降水时刻信息。
function detectRain(hourly, threshold = RAIN_PROB) {
  const sk = hourly.skycon || [], pr = hourly.precipitation || [];
  const n = Math.min(3, sk.length);
  for (let i = 0; i < n; i++) {
    const s = sk[i].value, p = pr[i];
    const hit = /RAIN|SNOW/.test(s) || (p && (p.probability >= threshold || p.value > 0.03));
    if (hit) {
      const hh = (sk[i].datetime || '').slice(11, 16);
      return {
        soon: true,
        now: i === 0,                                  // 当前小时即在下
        atHour: hh,
        prob: p ? p.probability : null,
        level: rainLevel(s, p),
        snow: /SNOW/.test(s),
      };
    }
  }
  return { soon: false };
}

// 把彩云原始 JSON 归一化成渲染层要的扁平结构。
function normalize(j, { threshold = RAIN_PROB, city = CITY } = {}) {
  if (!j || j.status !== 'ok' || !j.result) throw new Error('彩云返回异常: ' + (j && j.status));
  const r = j.result, rt = r.realtime;
  const sk = SKYCON[rt.skycon] || { label: rt.skycon, icon: 'cloudy', color: '#8b949e' };
  const today = (r.daily.temperature && r.daily.temperature[0]) || {};
  const aqi = rt.air_quality && rt.air_quality.aqi ? rt.air_quality.aqi.chn : null;
  return {
    city,
    tempNow: Math.round(rt.temperature),
    feels: Math.round(rt.apparent_temperature),
    hi: today.max == null ? null : Math.round(today.max),
    lo: today.min == null ? null : Math.round(today.min),
    skycon: rt.skycon, skyLabel: sk.label, icon: sk.icon, color: sk.color,
    aqi, aqiLevel: aqiLevel(aqi),
    humidity: Math.round((rt.humidity || 0) * 100),
    wind: windText(rt.wind && rt.wind.direction, rt.wind && rt.wind.speed),
    keypoint: r.forecast_keypoint || '',
    isDay: !/NIGHT/.test(rt.skycon),                   // 仅影响晴/多云的昼夜图标
    rain: detectRain(r.hourly, threshold),
    at: undefined,                                     // 由调用方打时间戳
  };
}

function buildUrl(token = TOKEN, coord = COORD) {
  return `https://api.caiyunapp.com/v2.6/${token}/${coord}/weather?dailysteps=3&hourlysteps=48`;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'nd104-panel/1.0' } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode !== 200) return reject(new Error(`HTTP ${r.statusCode}: ${d.slice(0, 120)}`));
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('天气请求超时')));
  });
}

async function fetchWeather({ token = TOKEN, coord = COORD, city = CITY, threshold = RAIN_PROB } = {}) {
  if (!token) throw new Error('缺少彩云 token: 请设置环境变量 CAIYUN_TOKEN(见 README)');
  const j = await getJson(buildUrl(token, coord));
  return normalize(j, { threshold, city });
}

// 带重试(仿 lib/quota.js:fetchQuotaRetry)。
async function fetchWeatherRetry(opts, tries = 3, delayMs = 1500) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fetchWeather(opts); }
    catch (e) { last = e; if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs)); }
  }
  throw last;
}

module.exports = {
  fetchWeather, fetchWeatherRetry, normalize, detectRain, buildUrl,
  SKYCON, aqiLevel, windText, TOKEN, COORD, CITY, RAIN_PROB,
};
