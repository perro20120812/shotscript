/**
 * ShotScript 剧本工坊 · Pro 激活校验模块（主进程）
 *
 * 职责：加载 Rust 原生 RSA 验签模块（napi-rs .node）、对外暴露 IPC、
 *       激活状态持久化（userData/license.json）、启动自动复验、设备绑定（一码一机）。
 *
 * 激活码格式（由 rust/ 签发工具生成）：
 *   base58( base64url(payload) + "." + base64url(RSA-SHA256 签名) )
 * 校验在 Rust 二进制内完成（公钥硬编码内嵌），本文件不做任何绕过。
 *
 * 设备绑定（无服务器"状态同步"方案）：
 *   激活成功时将当前设备指纹 deviceId 写入 store；启动复验时校验 deviceId 与
 *   本机一致才恢复激活。同码换机时新设备激活会覆盖绑定，旧设备下次启动
 *   因 deviceId 不匹配自动失效（以最后激活设备为准，近似互斥，无需中心服务器）。
 *   登出 = 清除 store + 上报 logout；换机流程 = 旧设备登出 -> 新设备重新激活。
 */
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { machineId } = require('../machineid/index.js');
const telemetry = require('../telemetry/index.js');
const remote = require('../remote/index.js');

// Rust 原生模块产物（构建后由 build-native 脚本复制到此路径）
const NATIVE_PATH = path.join(__dirname, '..', '..', 'rust', 'build', 'shotscript_license.node');

/** 激活状态持久化文件（userData 下） */
function licenseStoreFile() {
  return path.join(app.getPath('userData'), 'license.json');
}

let native = null;

/** 加载 Rust 原生模块，失败返回 null（不静默放行） */
function loadNative() {
  if (native) return native;
  try {
    native = require(NATIVE_PATH);
    console.log('[license] Rust 原生激活校验模块加载成功');
  } catch (err) {
    console.error('[license] 原生激活校验模块加载失败:', err.message);
    native = null;
  }
  return native;
}

/**
 * 验签一条激活码。
 * 返回 { ok, code, message, payload: { uid, type, exp } | null }
 * code: ok / err_format / err_parse / err_signature / err_expired / err_native
 */
function verifyCode(code) {
  const mod = loadNative();
  if (!mod) {
    return { ok: false, code: 'err_native', message: '激活校验模块加载失败，请重新安装应用', payload: null };
  }
  try {
    const res = mod.verify(String(code || '').trim());
    return res || { ok: false, code: 'err_native', message: '校验返回为空', payload: null };
  } catch (err) {
    return { ok: false, code: 'err_native', message: '激活校验异常: ' + err.message, payload: null };
  }
}

/** 激活码指纹（上报用，不落原文） */
function codeHash(code) {
  try {
    return crypto.createHash('sha256').update(String(code || '').trim()).digest('hex').slice(0, 12);
  } catch (_) {
    return '';
  }
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(licenseStoreFile(), 'utf-8'));
  } catch (_) {
    return null;
  }
}

function writeStore(store) {
  try {
    fs.mkdirSync(path.dirname(licenseStoreFile()), { recursive: true });
    fs.writeFileSync(licenseStoreFile(), JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[license] 激活状态持久化失败:', err.message);
  }
}

/** 清除持久化激活状态（截图验证未激活态 / 过期待清理 / 登出时用） */
function clearStore() {
  try {
    fs.unlinkSync(licenseStoreFile());
  } catch (_) {
    /* ignore */
  }
}

/**
 * 启动自动复验：读取持久化的激活码重新验签 + 设备绑定校验。
 * 有效且设备匹配 -> 返回激活态；过期 / 篡改 / 设备不匹配 -> 清除并返回未激活。
 */
function restoreActivation() {
  const store = readStore();
  if (!store || !store.code) {
    return { active: false, reason: 'not_activated', payload: null };
  }
  // 设备绑定校验：旧版本残留 store 无 deviceId 字段（含截图模式注入的 example 码残留），
  // 一律视为未激活并清除，杜绝"下载后 Pro 直接可用"。
  if (!store.deviceId) {
    clearStore();
    return { active: false, reason: 'device_unbound', payload: null, message: '本机未完成设备绑定，请重新激活' };
  }
  // 设备不匹配：同码已在其他设备激活，本机失效（近似互斥）
  const dev = machineId();
  if (store.deviceId !== dev) {
    clearStore();
    return { active: false, reason: 'device_mismatch', payload: null, message: '该激活码已在其他设备使用，请先在原设备退出登录' };
  }
  const res = verifyCode(store.code);
  if (res.ok && res.payload) {
    return { active: true, reason: 'ok', payload: res.payload, store, deviceId: dev };
  }
  clearStore();
  return { active: false, reason: res.code, payload: null, message: res.message };
}

/**
 * 登出（退出登录）：清除本机激活状态、上报 logout 事件，并向远程服务器释放席位。
 * 用于"旧设备释放 -> 新设备激活"的换机流程。
 */
async function logout() {
  const store = readStore();
  const uid = store && store.uid;
  const code = store && store.code;
  const deviceId = store && store.deviceId;
  clearStore();
  if (telemetry.reportLogout) {
    try { telemetry.reportLogout(); } catch (_) { /* ignore */ }
  }
  // 远程释放席位（服务器不可达时静默，本地仍已登出）
  if (remote.isEnabled() && code) {
    try { await remote.syncLogout(code, uid || '', deviceId || machineId()); } catch (_) { /* ignore */ }
  }
  return { ok: true, loggedOutUid: uid || null };
}

/**
 * 启动自动复验（异步版）：同步版 restoreActivation 基础上追加远程席位复验。
 * 规则：
 *  - 本地校验通过 + 远程启用且明确返回 released（席位被回收/登出）-> 清除并返回未激活；
 *  - 远程不可达 / 未启用 -> 保持本地激活态（离线降级，不误杀）；
 *  - 其余错误码照常处理。
 */
async function restoreActivationAsync() {
  const local = restoreActivation();
  if (!local.active || !remote.isEnabled()) return local;
  const dev = machineId();
  try {
    const r = await remote.syncVerify(local.store.code, local.store.uid || '', local.store.deviceId || dev);
    if (r.online === false && r.code === 'released') {
      clearStore();
      return { active: false, reason: 'seat_released', payload: null, message: '该激活码席位已释放，请重新激活' };
    }
  } catch (_) { /* 不可达：保持本地激活态 */ }
  return local;
}

/** 注册 IPC（app ready 后调用一次） */
function initLicense() {
  // 渲染层激活弹窗：提交激活码，成功则持久化并绑定当前设备 + 上报登入
  // 远程启用时：向服务器登记席位，明确拒绝（满席/非本人）则回滚本地激活。
  ipcMain.handle('license:verify', async (_event, code) => {
    const res = verifyCode(code);
    if (res.ok && res.payload) {
      const store = {
        code: String(code || '').trim(),
        uid: res.payload.uid,
        type: res.payload.type,
        exp: res.payload.exp,
        seats: res.payload.seats,
        activatedAt: Date.now(),
        deviceId: machineId()
      };
      writeStore(store);
      if (telemetry.reportLogin) {
        try { telemetry.reportLogin(res.payload.uid, { codeHash: codeHash(code), exp: res.payload.exp, seats: res.payload.seats }); } catch (_) { /* ignore */ }
      }
      // 远程同步：明确拒绝则回滚
      if (remote.isEnabled()) {
        try {
          const r = await remote.syncActivate(store.code, store.uid, store.deviceId);
          if (r.online === true && r.code && r.code !== 'ok') {
            clearStore();
            return { ok: false, code: r.code, message: r.message || '远程服务器拒绝了本次激活', payload: null, remote: true };
          }
          if (r.online === true && r.code === 'ok') {
            return Object.assign({}, res, { remote: true, seatsUsed: r.body.used, seatsLeft: r.body.left });
          }
          return Object.assign({}, res, { remote: false, remoteReason: r.reason || 'offline' });
        } catch (e) {
          return Object.assign({}, res, { remote: false, remoteReason: 'offline' });
        }
      }
    }
    return res;
  });

  // 渲染层启动时：查询激活状态（主进程自动复验 + 设备绑定校验 + 远程席位复验）
  ipcMain.handle('license:get-status', () => restoreActivationAsync());

  // 渲染层退出登录：清除激活 + 上报登出 + 远程释放席位（换机释放）
  ipcMain.handle('license:logout', () => logout());

  return { verifyCode, restoreActivation, restoreActivationAsync, clearStore, logout, loadNative };
}

module.exports = { initLicense, verifyCode, restoreActivation, restoreActivationAsync, clearStore, logout, loadNative };
