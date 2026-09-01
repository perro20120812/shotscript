/**
 * ShotScript · 远程授权同步（手机/自建服务器权威席位）
 *
 * 职责：把激活 / 登出 / 复验动作同步到远程授权服务器（默认跑在用户的安卓手机上，
 *       通过 Cloudflare Tunnel 暴露公网地址）。
 *
 * 设计原则（配合手机端低资源约束）：
 *  - 零依赖，仅用 Node 原生 fetch（Electron >= 18 内置）；
 *  - 所有请求短超时 + 失败静默，绝不影响本机正常使用（离线降级为本地软约束）；
 *  - 只在关键动作（激活 / 登出 / 启动复验）时发起，无心跳轮询，不空耗手机电量。
 *
 * 服务器地址来源（优先级从高到低）：
 *  1. 环境变量 SHOTSCRIPT_SERVER_URL
 *  2. userData/remote.json 中的 serverUrl 字段
 *  3. 未配置 -> 关闭远程同步，退回纯本机模式
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const REMOTE_TIMEOUT_MS = 2500;
const ADMIN_TOKEN = process.env.SHOTSCRIPT_ADMIN_TOKEN || '';

/** 远程配置持久化文件（userData/remote.json） */
function remoteConfigFile() {
  return path.join(app.getPath('userData'), 'remote.json');
}

/** 读取远程服务器地址（环境变量优先，其次配置文件） */
function getServerUrl() {
  if (process.env.SHOTSCRIPT_SERVER_URL) return process.env.SHOTSCRIPT_SERVER_URL.replace(/\/+$/, '');
  try {
    const cfg = JSON.parse(fs.readFileSync(remoteConfigFile(), 'utf-8'));
    if (cfg && cfg.serverUrl) return String(cfg.serverUrl).replace(/\/+$/, '');
  } catch (_) { /* 未配置 */ }
  return '';
}

/** 是否启用了远程授权同步 */
function isEnabled() {
  return !!getServerUrl();
}

/** 向远程服务器发起 JSON POST（短超时，失败抛错） */
async function postJson(serverUrl, apiPath, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (ADMIN_TOKEN) headers.Authorization = 'Bearer ' + ADMIN_TOKEN;
    const res = await fetch(serverUrl + apiPath, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    let json = {};
    try { json = await res.json(); } catch (_) { /* ignore */ }
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 激活同步（登录）：向远程服务器登记本机席位。
 * 返回：
 *   { online:true,  code:'ok' }          远程确认，席位已占用
 *   { online:true,  code:'seats_full' }  远程明确拒绝：席位已满 / 激活码绑定他人
 *   { online:false }                     服务器不可达（离线模式，不阻塞本机）
 */
async function syncActivate(code, uid, deviceId) {
  const serverUrl = getServerUrl();
  if (!serverUrl) return { online: false, reason: 'no_server' };
  try {
    const r = await postJson(serverUrl, '/api/v1/activate', { code, uid, deviceId });
    if (r.status === 200 && r.body && r.body.ok) {
      return { online: true, code: 'ok', body: r.body };
    }
    if (r.status === 409 && r.body && r.body.code) {
      return { online: true, code: r.body.code, message: r.body.message };
    }
    return { online: false, reason: 'remote_reject_' + r.status };
  } catch (_) {
    return { online: false, reason: 'unreachable' };
  }
}

/**
 * 登出同步：向远程服务器释放席位（换机前旧设备调用）。
 * 服务器不可达时静默失败，本地仍照常登出。
 */
async function syncLogout(code, uid, deviceId) {
  const serverUrl = getServerUrl();
  if (!serverUrl) return { ok: false, reason: 'no_server' };
  try {
    const r = await postJson(serverUrl, '/api/v1/logout', { code, uid, deviceId });
    return { ok: r.status === 200, body: r.body };
  } catch (_) {
    return { ok: false, reason: 'unreachable' };
  }
}

/**
 * 启动复验同步：询问远程服务器当前 uid 是否仍持有在线席位。
 * 用于多设备 / 席位被回收时让旧设备失效。
 * 返回：
 *   { online:true }   远程确认仍在线
 *   { online:false, code:'released' }  远程确认已不在线（席位被登出/回收）
 *   { online:false, reason:'unreachable' }  服务器不可达（保持本地激活态）
 */
async function syncVerify(code, uid, deviceId) {
  const serverUrl = getServerUrl();
  if (!serverUrl) return { online: false, reason: 'no_server' };
  try {
    const r = await postJson(serverUrl, '/api/v1/verify', { code, uid, deviceId });
    if (r.status === 200 && r.body) {
      if (r.body.active) return { online: true, body: r.body };
      return { online: false, code: 'released', body: r.body };
    }
    return { online: false, reason: 'remote_reject_' + r.status };
  } catch (_) {
    return { online: false, reason: 'unreachable' };
  }
}

module.exports = { getServerUrl, isEnabled, syncActivate, syncLogout, syncVerify, remoteConfigFile };
