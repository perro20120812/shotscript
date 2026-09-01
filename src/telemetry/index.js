/**
 * ShotScript · 遥测模块（本机日志 + 可选上报）
 *
 * 无服务器方案下的监控数据通道：
 *  - 每个用户首次启动即分配一个持久化唯一 ID（userData/identity.json），
 *    开源免费版用户同样拥有该 ID，不依赖 Pro 激活；
 *  - 所有事件先落盘到本机 JSONL；
 *  - 同时尝试 POST 到本地控制面板（默认 127.0.0.1:17680），失败静默。
 *
 * 事件采用数字编码以减小体积，约定：
 *   0 = 注销（deactivate）
 *   1 = 登录（login）
 *   2 = 登出（logout）
 *   3 = 活跃（active，用于日活统计）
 *   4 = 退出（quit，进程被关闭 / 不再活跃）
 *
 * 上报格式：{ uid, code, ... }，uid 为用户唯一 ID。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');
const { machineId } = require('../machineid/index.js');

const PANEL_HOST = process.env.SHOTSCRIPT_PANEL_URL || 'http://127.0.0.1:17680';
const PANEL_TIMEOUT_MS = 600;

/** 事件数字编码（与面板对照表保持一致） */
const EVENT_CODE = {
  DEACTIVATE: 0, // 注销
  LOGIN: 1,      // 登录
  LOGOUT: 2,     // 登出
  ACTIVE: 3,     // 活跃
  QUIT: 4        // 退出（不活跃）
};

let logFile = null;
let device = null;
let uid = null;

/** 用户唯一 ID 持久化文件 */
function identityFile() {
  return path.join(app.getPath('userData'), 'identity.json');
}

/**
 * 为当前用户分配 / 复用唯一 ID：
 *  - 首次启动生成随机 UUID 并落盘（开源版同样分配，无需激活）；
 *  - 后续启动复用已分配的 ID，保证同一用户跨会话稳定。
 */
function ensureUid() {
  if (uid) return uid;
  try {
    const st = JSON.parse(fs.readFileSync(identityFile(), 'utf-8'));
    if (st && st.uid) {
      uid = String(st.uid);
      return uid;
    }
  } catch (_) { /* 未初始化 */ }
  let newUid = '';
  try {
    newUid = crypto.randomUUID();
  } catch (_) {
    newUid = machineId(); // 兜底：UUID 不可用时退化为设备指纹
  }
  try {
    fs.mkdirSync(path.dirname(identityFile()), { recursive: true });
    fs.writeFileSync(identityFile(), JSON.stringify({ uid: newUid, createdAt: Date.now() }, null, 2), 'utf-8');
  } catch (_) { /* 落盘失败不影响内存值 */ }
  uid = newUid;
  return uid;
}

function telemetryFile() {
  if (!logFile) {
    const dir = path.join(app.getPath('userData'), 'telemetry');
    fs.mkdirSync(dir, { recursive: true });
    // 按月分文件，避免单文件无限膨胀
    const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
    logFile = path.join(dir, 'events-' + ym + '.jsonl');
  }
  return logFile;
}

function getDevice() {
  if (!device) {
    device = {
      id: machineId(),
      host: os.hostname(),
      platform: process.platform + '/' + process.arch
    };
  }
  return device;
}

/** 上报单个事件（同步落盘 + 异步尝试推送面板）。code 为数字编码 */
function report(code, payload = {}) {
  const dev = getDevice();
  const evt = Object.assign(
    {
      ts: Date.now(),
      day: new Date().toISOString().slice(0, 10),
      code: Number(code),
      uid: ensureUid(),
      deviceId: dev.id,
      host: dev.host,
      platform: dev.platform,
      app: app.getVersion ? app.getVersion() : ''
    },
    payload
  );
  try {
    fs.appendFileSync(telemetryFile(), JSON.stringify(evt) + '\n', 'utf-8');
  } catch (_) { /* ignore */ }
  pushToPanel(evt).catch(() => {});
  return evt;
}

/** 尝试推送到本地控制面板（失败静默，不阻塞业务） */
async function pushToPanel(evt) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PANEL_TIMEOUT_MS);
    const res = await fetch(PANEL_HOST + '/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evt),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res && !res.ok) throw new Error('panel status ' + res.status);
  } catch (_) { /* 面板不在线：静默 */ }
}

/** 注销（0）：预留的注销 / 激活作废事件 */
function reportDeactivate(extra) {
  return report(EVENT_CODE.DEACTIVATE, extra || {});
}

/** 登录（1）：不限 Pro，免费版打开应用即算登录 */
function reportLogin(uidHint, extra) {
  const payload = Object.assign({}, extra || {});
  if (uidHint) payload.actUid = uidHint; // 激活码中的 uid 作为附加信息保留
  return report(EVENT_CODE.LOGIN, payload);
}

/** 登出（2）：用户主动退出登录 / 释放激活 */
function reportLogout() {
  return report(EVENT_CODE.LOGOUT, {});
}

/** 每日活跃（3）：启动时调用，用于 DAU 统计 */
function reportActive() {
  return report(EVENT_CODE.ACTIVE, {});
}

/** 退出（4）：应用进程被关闭 / 不再活跃 */
function reportQuit() {
  return report(EVENT_CODE.QUIT, {});
}

module.exports = {
  EVENT_CODE,
  report,
  reportDeactivate,
  reportLogin,
  reportLogout,
  reportActive,
  reportQuit,
  ensureUid,
  getDevice,
  telemetryFile
};
