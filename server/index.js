#!/usr/bin/env node
/**
 * ShotScript 授权中心（手机端权威服务） · 零依赖单文件版
 *
 * 运行位置：用户安卓手机 Termux（也可跑在任何装了 Node 的机器上）
 * 设计目标：内存占用极小（常驻 <50MB）、空闲零轮询、事件驱动、JSONL 追加写。
 *
 * 功能：
 *  1. 激活码签发（需本机持有 private.pem + 管理 Token）——个人 Pro / 团队套餐
 *  2. 席位管理（权威台账）：个人 Pro=1 席、团队=5 席，登出释放、满席拒绝
 *  3. 用户身份记忆：uid → Pro 版状态，登出后保留、再登录自动恢复
 *  4. 遥测接收（login/logout/active/quit 数字编码）与日活统计
 *  5. 轻量统计 API + 可选的极简看板页
 *
 * 用法：
 *   SHOTSCRIPT_SERVER_PORT=8787 \
 *   SHOTSCRIPT_SERVER_TOKEN=你的管理Token \
 *   SHOTSCRIPT_PRIVATE_KEY=~/.shotscript-server/private.pem \
 *   node server/index.js
 *
 * 数据目录默认 ~/.shotscript-server/data（keys.json / users.json / events-YYYY-MM.jsonl）
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/* ===================== 配置 ===================== */
const PORT = Number(process.env.SHOTSCRIPT_SERVER_PORT || 8787);
const TOKEN = process.env.SHOTSCRIPT_SERVER_TOKEN || '';
const HOME = os.homedir();
const DATA_DIR = process.env.SHOTSCRIPT_SERVER_DATA || path.join(HOME, '.shotscript-server', 'data');
const PRIVATE_KEY_PATH = process.env.SHOTSCRIPT_PRIVATE_KEY || path.join(HOME, '.shotscript-server', 'private.pem');
const PUBLIC_KEY_PATH = process.env.SHOTSCRIPT_PUBLIC_KEY || path.join(HOME, '.shotscript-server', 'public.pem');

const keysFile = () => path.join(DATA_DIR, 'keys.json');
const usersFile = () => path.join(DATA_DIR, 'users.json');
const eventsFile = () => path.join(DATA_DIR, `events-${new Date().toISOString().slice(0, 10)}.jsonl`);
const downloadsFile = () => path.join(DATA_DIR, 'downloads.json');

function getDownloads() { return loadJSON(downloadsFile(), { count: 0 }); }

/** 事件数字编码（与客户端 telemetry EVENT_CODE 一致） */
const CODE_LABEL = { '-1': '签发', 0: '注销', 1: '登录', 2: '登出', 3: '活跃', 4: '退出', 5: '下载' };

/* ===================== 基础工具 ===================== */
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buf) {
  let digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let zeros = 0;
  for (const byte of buf) {
    if (byte !== 0) break;
    zeros++;
  }
  let out = '';
  for (let i = 0; i < zeros; i++) out += B58_ALPHABET[0];
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

function base58Decode(str) {
  let bytes = [0];
  for (const ch of String(str)) {
    const idx = B58_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  for (const ch of String(str)) {
    if (ch !== B58_ALPHABET[0]) break;
    zeros++;
  }
  const out = Buffer.alloc(bytes.length + zeros);
  for (let i = 0; i < zeros; i++) out[i] = 0;
  for (let i = 0; i < bytes.length; i++) out[i + zeros] = bytes[bytes.length - 1 - i];
  return out;
}

function codeHash(code) {
  return crypto.createHash('sha256').update(String(code || '').trim()).digest('hex').slice(0, 12);
}

/* ===================== 存储（JSON + JSONL 追加写） ===================== */
let keysCache = null;
let usersCache = null;
let dirtyKeys = false;
let dirtyUsers = false;

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (_) {
    return fallback;
  }
}

function saveJSON(file, obj) {
  try {
    ensureDir();
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch (_) { /* ignore */ }
}

function getKeys() {
  if (!keysCache) keysCache = loadJSON(keysFile(), {});
  return keysCache;
}
function getUsers() {
  if (!usersCache) usersCache = loadJSON(usersFile(), {});
  return usersCache;
}
function flush() {
  if (dirtyKeys) { saveJSON(keysFile(), getKeys()); dirtyKeys = false; }
  if (dirtyUsers) { saveJSON(usersFile(), getUsers()); dirtyUsers = false; }
}
// 定时落盘（每 3 秒一次，仅在脏时写）
setInterval(flush, 3000).unref();

function appendEvent(evt) {
  try {
    ensureDir();
    fs.appendFileSync(eventsFile(), JSON.stringify(evt) + '\n', 'utf-8');
  } catch (_) { /* ignore */ }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** 读取近 N 天事件（按天文件聚合，逐天读取避免常驻内存） */
function readEvents(days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const f = path.join(DATA_DIR, `events-${d}.jsonl`);
    try {
      const lines = fs.readFileSync(f, 'utf-8').split('\n');
      for (const l of lines) {
        if (!l.trim()) continue;
        try { out.push(JSON.parse(l)); } catch (_) { /* skip */ }
      }
    } catch (_) { /* no file */ }
  }
  return out;
}

/* ===================== 验签 / 签发（Node 复刻 Rust） ===================== */
function loadPublicPem() {
  return fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8');
}
function loadPrivatePem() {
  return fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8');
}

/**
 * 验签一条激活码。
 * payload 结构：{ uid, type:'Pro', seats: 1|5, exp }
 * 兼容旧格式（无 seats 字段 → 默认个人 Pro=1 席）。
 */
function verifyCode(code) {
  const fail = (c, message) => ({ ok: false, code: c, message, payload: null });
  try {
    const innerBuf = base58Decode(String(code || '').trim());
    if (!innerBuf) return fail('err_format', '激活码编码无效');
    const inner = innerBuf.toString('utf-8');
    const dot = inner.indexOf('.');
    if (dot <= 0) return fail('err_format', '激活码结构缺失');
    const b64Payload = inner.slice(0, dot);
    const b64Sig = inner.slice(dot + 1);
    if (!b64Payload || !b64Sig) return fail('err_format', '激活码结构缺失签名');

    const payloadBytes = Buffer.from(b64Payload, 'base64url');
    let payload;
    try {
      payload = JSON.parse(payloadBytes.toString('utf-8'));
    } catch (_) {
      return fail('err_parse', 'payload 解析失败');
    }

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(Buffer.from(b64Payload, 'utf-8'));
    const ok = verifier.verify(loadPublicPem(), Buffer.from(b64Sig, 'base64url'));
    if (!ok) return fail('err_signature', '签名校验失败（激活码无效或已被篡改）');

    if (payload.type !== 'Pro') return fail('err_signature', '激活类型不匹配');
    if (payload.exp < Math.floor(Date.now() / 1000)) return fail('err_expired', '激活码已过期');

    return { ok: true, code: 'ok', message: 'ok', payload };
  } catch (err) {
    return fail('err_native', '验签异常: ' + err.message);
  }
}

/**
 * 签发一条激活码（需私钥）。
 * @param {string} uid 用户 ID
 * @param {number} seats 席位：1=个人 Pro，5=团队套餐
 * @param {number} days 有效天数
 */
function issueCode(uid, seats, days) {
  const privatePem = loadPrivatePem();
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const payloadJson = JSON.stringify({ uid: String(uid).trim(), type: 'Pro', seats, exp });
  const b64Payload = Buffer.from(payloadJson, 'utf-8').toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(Buffer.from(b64Payload, 'utf-8'));
  const b64Sig = signer.sign(privatePem).toString('base64url');
  return base58Encode(Buffer.from(b64Payload + '.' + b64Sig, 'utf-8'));
}

/* ===================== 席位与用户身份核心逻辑 ===================== */
/**
 * 激活/登录（个人 Pro 与团队套餐统一处理）。
 * 规则：
 *  - 个人 Pro（seats=1）：密钥绑定 1 个 uid，同码另一设备激活 → 拒绝（请先退出）。
 *  - 团队（seats=5）：最多 5 个 uid 同时在线；同 uid 换设备视为重绑（允许）；满席 → 拒绝。
 *  - 用户身份记忆：uid → {edition, keyHash, active, deviceId}，登出保留 edition。
 */
function doActivate(code, uid, deviceId) {
  const v = verifyCode(code);
  if (!v.ok) return { ok: false, code: v.code, message: v.message };
  const payload = v.payload;
  const seats = Number(payload.seats) || 1;
  const key = codeHash(code);
  const keys = getKeys();
  const users = getUsers();

  let entry = keys[key];
  if (!entry) {
    entry = { key, seats, kind: seats > 1 ? 'team' : 'personal', uid: payload.uid, online: [], issuedAt: Date.now(), exp: payload.exp };
    keys[key] = entry;
  }

  // 密钥已注销：拒绝激活
  if (entry.revoked) {
    return { ok: false, code: 'revoked', message: '该激活码已被注销，无法使用', payload };
  }

  // 用户已是 Pro 版：直接返回，不重复占席位、不写日志、不写用户状态
  const existingUser = users[String(uid)];
  if (existingUser && (existingUser.edition === 'pro' || existingUser.edition === 'personal' || existingUser.edition === 'team') && existingUser.active === true) {
    return {
      ok: true,
      code: 'already_pro',
      message: '您已是 Pro 版，无需重复激活',
      payload,
      edition: existingUser.edition,
      seats: entry ? entry.seats : (seats || 1),
      used: entry ? entry.online.length : 0,
      left: entry ? Math.max(0, entry.seats - entry.online.length) : 0
    };
  }

  // 个人版：密钥归属用户 == 登录用户
  if (entry.seats <= 1 && entry.uid !== String(uid)) {
    return { ok: false, code: 'not_yours', message: '该激活码已绑定其他用户', payload };
  }

  // 已在在线列表（同 uid）：允许，更新设备指纹
  const exist = entry.online.find((o) => o.uid === String(uid));
  if (exist) {
    exist.deviceId = deviceId;
    exist.at = Date.now();
  } else {
    if (entry.online.length >= entry.seats) {
      return { ok: false, code: 'seats_full', message: `席位已满（${entry.seats}/${entry.seats}），请先让一名成员退出登录`, payload };
    }
    entry.online.push({ uid: String(uid), deviceId, at: Date.now() });
  }

  // 用户身份记忆（区分团队版/个人版：seats>1 为团队）
  users[String(uid)] = { edition: seats > 1 ? 'team' : 'personal', keyHash: key, active: true, deviceId, lastAt: Date.now() };

  dirtyKeys = true;
  dirtyUsers = true;
  appendEvent({ ts: Date.now(), day: todayStr(), code: 1, uid: String(uid), deviceId, key, seats });
  return {
    ok: true,
    code: 'ok',
    message: 'ok',
    payload,
    edition: 'pro',
    seats: entry.seats,
    used: entry.online.length,
    left: Math.max(0, entry.seats - entry.online.length)
  };
}

/** 登出：释放当前席位，但保留用户 Pro 身份记忆 */
function doLogout(code, uid, deviceId) {
  const key = codeHash(code);
  const keys = getKeys();
  const users = getUsers();
  const entry = keys[key];
  if (entry) {
    entry.online = entry.online.filter((o) => !(o.uid === String(uid) && (!deviceId || o.deviceId === deviceId)));
  }
  if (users[String(uid)]) {
    users[String(uid)].active = false;
    users[String(uid)].deviceId = '';
    users[String(uid)].lastAt = Date.now();
  }
  dirtyKeys = true;
  dirtyUsers = true;
  appendEvent({ ts: Date.now(), day: todayStr(), code: 2, uid: String(uid), deviceId: deviceId || '', key });
  return {
    ok: true,
    seats: entry ? entry.seats : 1,
    used: entry ? entry.online.length : 0,
    left: entry ? Math.max(0, entry.seats - entry.online.length) : 1
  };
}

/** 状态校验（客户端启动复验时调用） */
function doVerify(code, uid, deviceId) {
  const v = verifyCode(code);
  if (!v.ok) return { ok: false, code: v.code, message: v.message };
  const payload = v.payload;
  const key = codeHash(code);
  const keys = getKeys();
  const users = getUsers();
  const entry = keys[key];
  if (entry && entry.revoked) {
    return { ok: false, code: 'revoked', message: '该激活码已被注销，无法使用' };
  }
  const online = !!(entry && entry.online.find((o) => o.uid === String(uid)));
  const user = users[String(uid)];
  return {
    ok: true,
    code: 'ok',
    active: online,
    edition: user && user.edition ? user.edition : (entry && entry.seats > 1 ? 'team' : 'personal'),
    seats: entry ? entry.seats : (Number(payload.seats) || 1),
    used: entry ? entry.online.length : 0,
    left: entry ? Math.max(0, entry.seats - entry.online.length) : 0,
    payload
  };
}

/* ===================== 统计 ===================== */
function stats() {
  const events = readEvents(7);
  const keys = getKeys();
  const users = getUsers();
  const dau = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const devs = new Set();
    for (const e of events) if (e.day === day && Number(e.code) === 3) devs.add(e.deviceId);
    dau.push({ day, active: devs.size });
  }
  const now = todayStr();
  const todayEvents = events.filter((e) => e.day === now);
  const onlineUids = [];
  for (const k of Object.keys(keys)) {
    for (const o of keys[k].online) onlineUids.push({ uid: o.uid, deviceId: o.deviceId, at: o.at, seats: keys[k].seats, kind: keys[k].kind });
  }
  const personalUsers = Object.values(users).filter((u) => u.edition === 'personal' || u.edition === 'pro').length;
  const teamUsers = Object.values(users).filter((u) => u.edition === 'team').length;
  return {
    serverTime: Date.now(),
    today: now,
    downloads: getDownloads().count || 0,
    todayActive: new Set(todayEvents.filter((e) => Number(e.code) === 3).map((e) => e.deviceId)).size,
    todayLogins: todayEvents.filter((e) => Number(e.code) === 1).length,
    todayLogouts: todayEvents.filter((e) => Number(e.code) === 2).length,
    dau,
    keys: Object.keys(keys).length,
    users: Object.keys(users).length,
    proUsers: personalUsers + teamUsers,
    personalUsers,
    teamUsers,
    online: onlineUids
  };
}

/** 最近事件流水（登录/登出/活跃/签发/下载，按时间倒序） */
function recentEvents(limit) {
  const n = Number(limit) || 60;
  return readEvents(7).slice(-n).reverse().map((e) => ({
    ts: e.ts, day: e.day, code: Number(e.code), label: CODE_LABEL[String(e.code)] || e.code,
    uid: e.uid || '', deviceId: e.deviceId || '', key: e.key || '', seats: e.seats || 0
  }));
}

/* ===================== HTTP 服务 ===================== */
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}
function sendJson(res, obj, status) {
  const body = JSON.stringify(obj);
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function authOk(req) {
  if (!TOKEN) return false; // 未配置 Token 则拒绝所有管理接口（安全兜底）
  const h = req.headers.authorization || '';
  return h === 'Bearer ' + TOKEN;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'OPTIONS') { sendJson(res, { ok: true }); return; }

  // —— 遥测接收（客户端每次上报，无鉴权但只写事件）——
  if (p === '/api/v1/telemetry' && req.method === 'POST') {
    const body = await readBody(req);
    let evt;
    try { evt = JSON.parse(body); } catch (_) { sendJson(res, { ok: false, message: 'bad json' }, 400); return; }
    evt.ts = evt.ts || Date.now();
    evt.day = todayStr();
    appendEvent(evt);
    sendJson(res, { ok: true });
    return;
  }

  // —— 激活 ——
  if (p === '/api/v1/activate' && req.method === 'POST') {
    const body = await readBody(req);
    let b;
    try { b = JSON.parse(body); } catch (_) { sendJson(res, { ok: false, message: 'bad json' }, 400); return; }
    const r = doActivate(b.code, b.uid, b.deviceId);
    sendJson(res, r, r.ok ? 200 : 409);
    return;
  }

  // —— 登出 ——
  if (p === '/api/v1/logout' && req.method === 'POST') {
    const body = await readBody(req);
    let b;
    try { b = JSON.parse(body); } catch (_) { sendJson(res, { ok: false, message: 'bad json' }, 400); return; }
    sendJson(res, doLogout(b.code, b.uid, b.deviceId));
    return;
  }

  // —— 状态校验 ——
  if (p === '/api/v1/verify' && req.method === 'POST') {
    const body = await readBody(req);
    let b;
    try { b = JSON.parse(body); } catch (_) { sendJson(res, { ok: false, message: 'bad json' }, 400); return; }
    sendJson(res, doVerify(b.code, b.uid, b.deviceId));
    return;
  }

  // —— 下载计数（下载页/安装包跳转时上报一次）——
  if (p === '/api/v1/download' && req.method === 'POST') {
    const d = getDownloads();
    d.count = (d.count || 0) + 1;
    saveJSON(downloadsFile(), d);
    appendEvent({ ts: Date.now(), day: todayStr(), code: 5, uid: 'download', deviceId: '', key: '', seats: 0 });
    sendJson(res, { ok: true, count: d.count });
    return;
  }

  // —— 事件流水（登录/登出/活跃/签发/下载）——
  if (p === '/api/v1/events' && req.method === 'GET') {
    sendJson(res, { ok: true, events: recentEvents(url.searchParams.get('limit')) });
    return;
  }

  // —— 管理：签发（需 Token + 私钥）——
  if (p === '/api/v1/issue' && req.method === 'POST') {
    if (!authOk(req)) { sendJson(res, { ok: false, message: 'unauthorized' }, 401); return; }
    const body = await readBody(req);
    let b;
    try { b = JSON.parse(body); } catch (_) { sendJson(res, { ok: false, message: 'bad json' }, 400); return; }
    try {
      const seats = Number(b.seats) === 5 ? 5 : 1;
      const code = issueCode(b.uid || 'dev-user-' + Date.now(), seats, Number(b.days) || 365);
      appendEvent({ ts: Date.now(), day: todayStr(), code: -1, uid: b.uid || '', deviceId: '', key: codeHash(code), seats });
      sendJson(res, { ok: true, code, seats });
    } catch (err) {
      sendJson(res, { ok: false, message: '签发失败: ' + err.message }, 500);
    }
    return;
  }

  // —— 管理：注销（需 Token）——
  if (p === '/api/v1/revoke' && req.method === 'POST') {
    if (!authOk(req)) { sendJson(res, { ok: false, message: 'unauthorized' }, 401); return; }
    const body = await readBody(req);
    let b;
    try { b = JSON.parse(body); } catch (_) { sendJson(res, { ok: false, message: 'bad json' }, 400); return; }
    const key = codeHash(b.code);
    const entry = getKeys()[key];
    if (entry) {
      entry.revoked = true;
      dirtyKeys = true;
      appendEvent({ ts: Date.now(), day: todayStr(), code: 0, uid: '', deviceId: '', key, seats: 0 });
      sendJson(res, { ok: true, message: '已注销' });
    } else {
      sendJson(res, { ok: false, message: '密钥不存在' }, 404);
    }
    return;
  }

  // —— 管理：统计 ——
  if (p === '/api/v1/stats') {
    sendJson(res, stats());
    return;
  }

  // —— 监控看板页（手机 App 形态，可"添加到主屏幕"全屏使用）——
  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0d1117">
<title>ShotScript 监控台</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;background:#0d1117;color:#e6edf3;padding:16px 14px calc(40px + env(safe-area-inset-bottom));max-width:560px;margin:0 auto;-webkit-font-smoothing:antialiased}
header{display:flex;align-items:center;justify-content:space-between;margin:6px 2px 14px}
header h1{font-size:20px;font-weight:700;letter-spacing:.3px}
header .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#3fb950;margin-right:6px;vertical-align:2px;box-shadow:0 0 8px #3fb95088}
.sub{color:#8b949e;font-size:12px;margin-top:3px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:9px}
.card{background:#161b22;border:1px solid #21262d;border-radius:14px;padding:13px 12px 12px}
.card .k{color:#8b949e;font-size:11px;margin-bottom:5px}
.card .v{font-size:22px;font-weight:700;letter-spacing:.3px}
.card .v.g{color:#3fb950}.card .v.b{color:#58a6ff}.card .v.o{color:#e3b341}.card .v.p{color:#bc8cff}
.section{font-size:13px;font-weight:600;color:#8b949e;margin:18px 2px 8px;text-transform:uppercase;letter-spacing:.5px}
.bar{display:flex;align-items:flex-end;gap:6px;height:70px;padding:6px 2px;background:#161b22;border:1px solid #21262d;border-radius:14px;padding:12px 10px}
.bar-item{flex:1;background:#58a6ff;border-radius:5px 5px 0 0;min-height:2px;position:relative}
.bar-item .lb{position:absolute;bottom:-20px;left:0;right:0;text-align:center;font-size:9.5px;color:#8b949e}
.bar-item .nv{position:absolute;top:-17px;left:0;right:0;text-align:center;font-size:9.5px;color:#58a6ff;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:12px;background:#161b22;border:1px solid #21262d;border-radius:14px;overflow:hidden}
th{color:#8b949e;font-weight:500;text-align:left;padding:9px 10px;border-bottom:1px solid #21262d;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px}
td{padding:9px 10px;border-bottom:1px solid #1c2128}
tr:last-child td{border-bottom:none}
.badge{display:inline-block;font-size:10px;padding:2px 7px;border-radius:20px;font-weight:600}
.badge.on{background:#1f6feb33;color:#58a6ff}
.badge.team{background:#d29922 33;color:#e3b341}
.badge.pers{background:#3fb95033;color:#3fb950}
.tbl-wrap{border-radius:14px;overflow:hidden}
.ev{display:flex;align-items:center;gap:10px;padding:9px 12px;background:#161b22;border:1px solid #21262d;border-radius:12px;margin-bottom:6px}
.ev .ic{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
.ic.login{background:#1f6feb33;color:#58a6ff}.ic.logout{background:#f8514933;color:#f85149}.ic.act{background:#3fb95033;color:#3fb950}.ic.issue{background:#bc8cff33;color:#bc8cff}.ic.dl{background:#e3b34133;color:#e3b341}
.ev .bd{flex:1;min-width:0}
.ev .bd .u{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev .bd .t{font-size:11px;color:#8b949e;margin-top:2px}
.ev .tm{font-size:10.5px;color:#6e7681;flex-shrink:0}
footer{margin-top:18px;text-align:center;color:#484f58;font-size:10.5px}
</style></head>
<body>
<header><div><h1><span class="dot"></span>ShotScript 监控台</h1><div class="sub" id="upd">-</div></div></header>

<div class="grid">
  <div class="card"><div class="k">累计下载</div><div class="v g" id="c-dl">-</div></div>
  <div class="card"><div class="k">今日活跃</div><div class="v b" id="c-now">-</div></div>
  <div class="card"><div class="k">今日登入</div><div class="v" id="c-login">-</div></div>
  <div class="card"><div class="k">今日登出</div><div class="v" id="c-logout">-</div></div>
  <div class="card"><div class="k">个人 Pro</div><div class="v p" id="c-pers">-</div></div>
  <div class="card"><div class="k">团队</div><div class="v" id="c-team">-</div></div>
  <div class="card"><div class="k">当前在线</div><div class="v o" id="c-online">-</div></div>
</div>

<div class="section">近 7 日活跃设备</div>
<div class="bar" id="bar"></div>

<div class="section">当前在线用户</div>
<div class="tbl-wrap"><table><tr><th>uid（唯一ID）</th><th>类型</th><th>登录时间</th></tr><tbody id="tbl"></tbody></table></div>

<div class="section">实时流水（登录 / 登出 / 下载）</div>
<div id="events"></div>

<footer>数据由手机授权中心实时采集 · 每 10 秒自动刷新</footer>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function fmt(ts){const d=new Date(ts);const p=n=>String(n).padStart(2,'0');return p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())}
async function load(){
  try{
    const s=await (await fetch('/api/v1/stats')).json();
    c-dl.textContent=s.downloads;c-now.textContent=s.todayActive;c-login.textContent=s.todayLogins;c-logout.textContent=s.todayLogouts;c-pers.textContent=s.personalUsers;c-team.textContent=s.teamUsers;c-online.textContent=s.online.length;
    const mx=Math.max(...s.dau.map(x=>x.active),1);
    bar.innerHTML=s.dau.map(d=>'<div class="bar-item" style="height:'+Math.max(3,Math.round(d.active/mx*52))+2+'px"><span class="nv">'+d.active+'</span><span class="lb">'+d.day.slice(5)+'</span></div>').join('');
    tbl.innerHTML=s.online.map(o=>'<tr><td>'+esc(o.uid)+'</td><td>'+(o.seats>1?'<span class="badge team">团队×'+o.seats+'</span>':'<span class="badge pers">个人</span>')+'</td><td>'+fmt(o.at)+'</td></tr>').join('')||'<tr><td colspan="3" style="color:#6e7681;text-align:center">暂无在线</td></tr>';
    upd.textContent='更新于 '+fmt(s.serverTime)+' · 数据实时';
  }catch(e){upd.textContent='连接异常，等待重试…'}
  try{
    const r=await (await fetch('/api/v1/events?limit=30')).json();
    const ic={1:'login',2:'logout',3:'act',5:'dl','-1':'issue'};
    events.innerHTML=r.events.map(e=>{
      const c=Number(e.code);
      const lbl=e.label||('#'+c);
      const u=e.uid||(c===5?'下载':'-');
      return '<div class="ev"><div class="ic '+(ic[c]||'act')+'">'+(c===1?'↑':c===2?'↓':c===3?'●':c===5?'↓':lbl)+'</div><div class="bd"><div class="u">'+esc(u)+'</div><div class="t">'+esc(lbl)+' · '+(e.deviceId?esc(e.deviceId):'')+'</div></div><div class="tm">'+fmt(e.ts)+'</div></div>';
    }).join('')||'<div class="ev"><div class="bd"><div class="u">暂无记录</div></div></div>';
  }catch(e){}
}
load();setInterval(load,10000);
</script></body></html>`);
    return;
  }

  sendJson(res, { ok: false, message: 'not found' }, 404);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ShotScript 授权中心] 已启动 http://0.0.0.0:${PORT}`);
  console.log(`  数据目录: ${DATA_DIR}`);
  console.log(`  管理 Token: ${TOKEN ? '已配置' : '未配置(管理接口禁用!)'}`);
  console.log(`  私钥: ${fs.existsSync(PRIVATE_KEY_PATH) ? '就绪' : '缺失: ' + PRIVATE_KEY_PATH}`);
});
