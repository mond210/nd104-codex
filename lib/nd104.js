'use strict';
/*
 * lib/nd104.js —— ND104 屏幕协议核心(可复用)。
 * 供 nd104-push.js(CLI) 和 push-daemon.js(常驻) 共用,单一事实来源。
 * 协议细节见 ../protocol-spec.md。CRC 已实测确认为标准 CRC-32(zlib) 小端。
 */

const VID = 0x5542, PID = 0x0001;
const USAGE_PAGE = 0xff60, USAGE = 0x61;
const REPORT_LEN = 64, FRAME_MAX = 62, BLOCK = 4096;
const SCREEN_W = 320, SCREEN_H = 172;
const ACK_TIMEOUT_MS = 1500;

// ---------- CRC ----------
function crcByte(b, poly) { let c = (b & 0xff) << 24; for (let k = 0; k < 8; k++) c = (c & 0x80000000) ? ((c << 1) ^ poly) : (c << 1); return c >>> 0; }
function reflect(v, bits) { let r = 0; for (let i = 0; i < bits; i++) { r = (r << 1) | (v & 1); v >>>= 1; } return r >>> 0; }
function makeCrc32(poly, init, refin, refout, xorout) {
  return function (buf) {
    let crc = init >>> 0;
    for (let i = 0; i < buf.length; i++) {
      const b = refin ? reflect(buf[i], 8) : buf[i];
      crc = ((crc << 8) ^ crcByte((crc >>> 24) ^ b, poly)) >>> 0;
    }
    if (refout) crc = reflect(crc, 32);
    return (crc ^ (xorout >>> 0)) >>> 0;
  };
}
function sum32(buf) { let s = 0; for (const b of buf) s = (s + b) >>> 0; return s >>> 0; }
function withOrder(fn, order) {
  return function (buf) { const v = fn(buf) >>> 0, o = Buffer.alloc(4); order === 'le' ? o.writeUInt32LE(v, 0) : o.writeUInt32BE(v, 0); return o; };
}
const CRC_VARIANTS = {
  crc32le:     withOrder(makeCrc32(0x04c11db7, 0xffffffff, true, true, 0xffffffff), 'le'),  // 实测确认
  crc32be:     withOrder(makeCrc32(0x04c11db7, 0xffffffff, true, true, 0xffffffff), 'be'),
  crc32mpegle: withOrder(makeCrc32(0x04c11db7, 0xffffffff, false, false, 0x00000000), 'le'),
  crc32mpegbe: withOrder(makeCrc32(0x04c11db7, 0xffffffff, false, false, 0x00000000), 'be'),
  crc32bzle:   withOrder(makeCrc32(0x04c11db7, 0xffffffff, false, false, 0xffffffff), 'le'),
  crc32bzbe:   withOrder(makeCrc32(0x04c11db7, 0xffffffff, false, false, 0xffffffff), 'be'),
  sum32le:     withOrder(sum32, 'le'),
  sum32be:     withOrder(sum32, 'be'),
};
const AUTODETECT_ORDER = ['crc32le', 'crc32be', 'crc32mpegle', 'crc32mpegbe', 'crc32bzle', 'crc32bzbe', 'sum32le', 'sum32be'];

// ---------- 帧构造 ----------
function padFrame(bytes) { const f = Buffer.alloc(REPORT_LEN); Buffer.from(bytes).copy(f, 0); return f; }
// 多帧容器(实测,官方"GIF"就是这个): 每帧是一张 JPEG,设备端自动循环播放。
//   55 42 | W(2BE) | H(2BE) | N(2BE 帧数) | 每帧延时(1字节 ×N) | 每帧大小(4字节BE ×N) | jpeg0 jpeg1 ...
// 静态单图 = N=1 的特例(与最初 JPEG 抓包完全自洽)。delay 单位未知,官方用 10。
function buildFramesWrapper(frames, { delay = 10, w = SCREEN_W, h = SCREEN_H } = {}) {
  const N = frames.length;
  const head = [0x55, 0x42, (w >> 8) & 0xff, w & 0xff, (h >> 8) & 0xff, h & 0xff, (N >> 8) & 0xff, N & 0xff];
  const delays = Array.isArray(delay) ? delay : new Array(N).fill(delay);
  for (let i = 0; i < N; i++) head.push(delays[i] & 0xff);
  for (const f of frames) { const L = f.length; head.push((L >>> 24) & 0xff, (L >>> 16) & 0xff, (L >>> 8) & 0xff, L & 0xff); }
  return Buffer.concat([Buffer.from(head), ...frames]);
}
// 单张图片 = 多帧容器的 N=1 特例。
function buildWrapper(jpeg, w = SCREEN_W, h = SCREEN_H, delay = 1) {
  return buildFramesWrapper([jpeg], { delay, w, h });
}
function buildAnnounce(total) {
  return padFrame([0xBA, 0x06, 0xAA, 0xB0, (total >>> 24) & 0xff, (total >>> 16) & 0xff, (total >>> 8) & 0xff, total & 0xff]);
}
function buildFrames(stream, crcFn) {
  const out = [];
  for (let bs = 0; bs < stream.length; bs += BLOCK) {
    const block = stream.subarray(bs, Math.min(bs + BLOCK, stream.length));
    for (let off = 0; off < block.length; off += FRAME_MAX) {
      const chunk = block.subarray(off, Math.min(off + FRAME_MAX, block.length));
      out.push({ type: 'data', frame: padFrame([0xBA, chunk.length, ...chunk]) });
    }
    // 实测: 设备不需要 BA04 校验帧,发错误 CRC 反而会破坏码流(交接处乱码/截断)。
    // 故默认不发;仅当 ND_WITH_CRC 且提供了正确算法时才发(留作调试)。
    if (block.length === BLOCK && process.env.ND_WITH_CRC && crcFn) out.push({ type: 'crc', frame: padFrame([0xBA, 0x04, ...crcFn(block)]) });
  }
  return out;
}

// ---------- 设备 IO ----------
function openDevice(HID) {
  const all = HID.devices();
  const cand = all.filter(d => d.vendorId === VID && d.productId === PID);
  if (!cand.length) throw new Error(`未找到屏幕设备 0x5542/0x0001。确认键盘已插好,且官方网页已关闭(它会独占设备)。`);
  const byUsage = cand.find(d => d.usagePage === USAGE_PAGE && d.usage === USAGE);
  const dev = new HID.HID((byUsage || cand[0]).path);
  const acks = [], waiters = [];
  // ND_NO_ACK: 完全不注册读回调(纯发送),用来排查"读 ack 与写并发在 macOS 上互相干扰"。
  if (!process.env.ND_NO_ACK) {
    dev.on('data', (buf) => {
      let d = buf; if (d.length === REPORT_LEN + 1) d = d.subarray(1);
      if (d[0] === 0xBA && d[2] === 0xA5) { const rec = { status: d[6], raw: Buffer.from(d) }; waiters.length ? waiters.shift()(rec) : acks.push(rec); }
    });
  }
  dev.on('error', () => {});
  return {
    write: (frame) => dev.write([0x00, ...frame]),
    waitAck: (timeout = ACK_TIMEOUT_MS) => acks.length ? Promise.resolve(acks.shift()) : new Promise((res) => {
      const t = setTimeout(() => { const i = waiters.indexOf(cb); if (i >= 0) waiters.splice(i, 1); res(null); }, timeout);
      const cb = (r) => { clearTimeout(t); res(r); }; waiters.push(cb);
    }),
    close: () => { try { dev.close(); } catch (e) {} },
  };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 用已打开的 io 发一个包裹流。返回 {ok, ms}。ok=false 表示设备回了 FD(重传/CRC 不符)。
// 关键: 发完最后一帧后必须 hold(endHold) 再让调用方 close(),否则 macOS 上仍在
// 排队的 HID 输出报文会被 close 取消,导致尾部块丢失、图片只显示前一部分。
async function sendStream(io, stream, crcName = 'crc32le', opts = {}) {
  // 可用环境变量覆盖: ND_FRAME_DELAY / ND_BLOCK_DELAY / ND_END_HOLD (毫秒)
  const {
    frameDelay = +process.env.ND_FRAME_DELAY || 3,
    blockDelay = +process.env.ND_BLOCK_DELAY || 10,
    endHold    = +process.env.ND_END_HOLD || 500,
  } = opts;
  const t0 = Date.now();
  const frames = buildFrames(stream, CRC_VARIANTS[crcName]);
  const noAck = !!process.env.ND_NO_ACK;
  io.write(buildAnnounce(stream.length));
  if (!noAck) await io.waitAck(500);
  for (const f of frames) {
    io.write(f.frame);
    await sleep(frameDelay);
    if (f.type === 'crc') {
      if (!noAck) { const ack = await io.waitAck(); if (ack && ack.status === 0xFD) return { ok: false, ms: Date.now() - t0 }; }
      await sleep(blockDelay);                 // 给设备喘息(贴近官方块间停顿)
    }
  }
  await sleep(endHold);                          // 等 OS 把最后一块全部刷给设备,再由调用方 close
  return { ok: true, ms: Date.now() - t0 };
}

// 高层: 打开设备→推一张 JPEG→关闭。crc 缺省用实测确认的 crc32le。
async function pushJpeg(jpeg, { HID, crc = 'crc32le', w = SCREEN_W, h = SCREEN_H } = {}) {
  if (!HID) HID = require('node-hid');
  const io = openDevice(HID);
  try { return await sendStream(io, buildWrapper(jpeg, w, h), crc); }
  finally { io.close(); }
}

// 高层: 推多帧(每帧一张 JPEG),设备端自动循环播放。delay 可为数字或每帧数组。
async function pushFrames(frames, { HID, delay = 10, crc = 'crc32le', w = SCREEN_W, h = SCREEN_H } = {}) {
  if (!HID) HID = require('node-hid');
  const io = openDevice(HID);
  try { return await sendStream(io, buildFramesWrapper(frames, { delay, w, h }), crc); }
  finally { io.close(); }
}

module.exports = {
  SCREEN_W, SCREEN_H, VID, PID, CRC_VARIANTS, AUTODETECT_ORDER,
  buildWrapper, buildFramesWrapper, buildAnnounce, buildFrames, openDevice, sendStream, pushJpeg, pushFrames, sleep,
};
