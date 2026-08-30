/**
 * ShotScript 剧本工坊 · Pro 激活校验模块（主进程）
 *
 * 职责：加载 Rust 原生 RSA 验签模块（napi-rs .node）、对外暴露 IPC、
 *       激活状态持久化（userData/license.json）、启动自动复验。
 *
 * 激活码格式（由 rust/ 签发工具生成）：
 *   base58( base64url(payload) + "." + base64url(RSA-SHA256 签名) )
 * 校验在 Rust 二进制内完成（公钥硬编码内嵌），本文件不做任何绕过。
 */
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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

/** 清除持久化激活状态（截图验证未激活态 / 过期待清理时用） */
function clearStore() {
  try {
    fs.unlinkSync(licenseStoreFile());
  } catch (_) {
    /* ignore */
  }
}

/**
 * 启动自动复验：读取持久化的激活码重新验签。
 * 有效 -> 返回激活态；过期 / 篡改 / 缺失 -> 清除并返回未激活。
 */
function restoreActivation() {
  const store = readStore();
  if (!store || !store.code) {
    return { active: false, reason: 'not_activated', payload: null };
  }
  const res = verifyCode(store.code);
  if (res.ok && res.payload) {
    return { active: true, reason: 'ok', payload: res.payload, store };
  }
  clearStore();
  return { active: false, reason: res.code, payload: null, message: res.message };
}

/** 注册 IPC（app ready 后调用一次） */
function initLicense() {
  // 渲染层激活弹窗：提交激活码，成功则持久化
  ipcMain.handle('license:verify', (_event, code) => {
    const res = verifyCode(code);
    if (res.ok && res.payload) {
      writeStore({
        code: String(code || '').trim(),
        uid: res.payload.uid,
        type: res.payload.type,
        exp: res.payload.exp,
        activatedAt: Date.now()
      });
    }
    return res;
  });

  // 渲染层启动时：查询激活状态（主进程自动复验）
  ipcMain.handle('license:get-status', () => restoreActivation());

  return { verifyCode, restoreActivation, clearStore, loadNative };
}

module.exports = { initLicense, verifyCode, restoreActivation, clearStore, loadNative };
