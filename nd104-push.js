#!/usr/bin/env node
'use strict';
/*
 * nd104-push.js —— 向 ND104 小键盘 320x172 屏幕推送一张图片(命令行)。
 * 协议实现见 lib/nd104.js;协议细节见 protocol-spec.md。
 * 用法:
 *   node nd104-push.js image.jpg                 # 推一张图(png 等会自动转 320x172 JPEG)
 *   node nd104-push.js image.jpg --crc crc32le   # 指定 CRC(实测确认值,跳过自动探测)
 *   node nd104-push.js image.jpg --dry-run       # 只构帧核对,不连硬件
 *   node nd104-push.js --list                     # 列出可见 HID 设备
 */
const fs = require('fs');
const nd = require('./lib/nd104');

async function loadJpeg(path) {
  const raw = fs.readFileSync(path);
  const isJpeg = raw[0] === 0xff && raw[1] === 0xd8;
  if (isJpeg && sizeOk(jpegSize(raw))) return raw;
  let sharp; try { sharp = require('sharp'); } catch (e) {
    if (isJpeg) return raw; // 是 JPEG 但尺寸不符且无 sharp → 硬送
    die('输入非 320x172 JPEG 且未装 sharp。请: npm i sharp,或用 sips 预转: sips -z 172 320 in.png --out out.jpg -s format jpeg');
  }
  return await sharp(path).resize(nd.SCREEN_W, nd.SCREEN_H, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer();
}
function sizeOk(d) { return d && d.w === nd.SCREEN_W && d.h === nd.SCREEN_H; }
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
    i += 2 + ((buf[i + 2] << 8) | buf[i + 3]);
  }
  return null;
}
const hx = (b) => Buffer.from(b).toString('hex').replace(/(..)/g, '$1 ').trim();
function die(m) { console.error('[error] ' + m); process.exit(1); }

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) { console.log(require('node-hid').devices()); return; }
  const file = args.find(a => !a.startsWith('--'));
  if (!file) die('用法: node nd104-push.js <image> [--dry-run] [--list]');
  const jpeg = await loadJpeg(file);
  const stream = nd.buildWrapper(jpeg);
  console.log(`[img] JPEG ${jpeg.length} 字节 → 包裹流 ${stream.length} 字节 (13 头 + JPEG)`);
  console.log(`[chk] 预告帧:    ${hx(nd.buildAnnounce(stream.length).subarray(0, 8))}`);
  console.log(`[chk] 首数据帧头: ${hx(Buffer.concat([Buffer.from([0xBA, 0x3E]), stream.subarray(0, 13)]))}`);

  if (args.includes('--dry-run')) {
    const f = nd.buildFrames(stream, nd.CRC_VARIANTS.crc32le);
    console.log(`[dry] 满块数 ${f.filter(x => x.type === 'crc').length}, 总帧 ${f.length}。未连接硬件。`);
    return;
  }

  // 实测: 设备无需 CRC 帧,直接顺序发数据帧即可(见 protocol-spec.md)。
  const HID = require('node-hid');
  const io = nd.openDevice(HID);
  try {
    const r = await nd.sendStream(io, stream);
    console.log(`[done] 上传完成,用时 ${r.ms}ms`);
  } finally { io.close(); }
}
main().catch(e => { console.error(e); process.exit(1); });
