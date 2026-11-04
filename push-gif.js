#!/usr/bin/env node
'use strict';
/*
 * push-gif.js —— 推送动画到屏幕(设备端自动循环播放)。
 * 实测格式: 多帧 JPEG 容器(见 protocol-spec.md / lib/nd104.js:buildFramesWrapper)。
 *   把动画 GIF 的每一帧抽出 → 各编码为 320x172 JPEG → 打包成容器 → 走普通传输发送。
 * 用法:
 *   node push-gif.js anim.gif                 # 推动画(每帧延时默认 10)
 *   node push-gif.js anim.gif --delay 20      # 放慢
 *   node push-gif.js anim.gif --dry-run       # 只构帧看头,不连硬件
 */
const fs = require('fs');
const nd = require('./lib/nd104');

function ensureJfif(jpg) {
  if (jpg[2] === 0xff && jpg[3] === 0xe0) return jpg;
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return Buffer.concat([jpg.subarray(0, 2), app0, jpg.subarray(2)]);
}

// 从动画图(GIF/WebP/APNG)抽帧 → 每帧一张 320x172 JPEG
async function loadFrames(path) {
  const sharp = require('sharp');
  const raw = fs.readFileSync(path);
  const meta = await sharp(raw, { animated: true }).metadata();
  const pages = meta.pages || 1;
  const frames = [];
  for (let i = 0; i < pages; i++) {
    const jpg = await sharp(raw, { page: i }).resize(nd.SCREEN_W, nd.SCREEN_H, { fit: 'cover' })
      .jpeg({ quality: 88, chromaSubsampling: '4:2:0', progressive: false, optimizeCoding: false }).toBuffer();
    frames.push(ensureJfif(jpg));
  }
  return frames;
}
const hx = (b) => Buffer.from(b).toString('hex').replace(/(..)/g, '$1 ').trim();

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('用法: node push-gif.js <anim.gif> [--delay N] [--dry-run]'); process.exit(1); }
  const di = args.indexOf('--delay');
  const delay = di >= 0 ? parseInt(args[di + 1], 10) : 10;

  const frames = await loadFrames(file);
  const stream = nd.buildFramesWrapper(frames, { delay });
  console.log(`[anim] ${file}: ${frames.length} 帧, 每帧 JPEG 约 ${Math.round(frames.reduce((a, f) => a + f.length, 0) / frames.length)} 字节, 延时=${delay}`);
  console.log(`[anim] 容器 ${stream.length} 字节; 头 ${hx(stream.subarray(0, 8 + frames.length + frames.length * 4))}`);

  if (args.includes('--dry-run')) { console.log(`[dry] 打包帧数 ${nd.buildFrames(stream, null).length}(不连硬件)`); return; }
  const r = await nd.pushFrames(frames, { delay });
  console.log(`[done] 发送完成 ${r.ms}ms —— 屏幕应循环播放 ${frames.length} 帧`);
}
main().catch(e => { console.error(e); process.exit(1); });
