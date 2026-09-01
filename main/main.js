/**
 * ShotScript 剧本工坊 - Electron 主进程
 * 负责：创建毛玻璃窗口、系统菜单、文件保存 IPC、截图验证模式
 */
const { app, BrowserWindow, ipcMain, dialog, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// 本地 AI 润色模块（Pro 闭源能力：开源版若未随包提供该模块则跳过初始化）
let initLlm = null;
try { ({ initLlm } = require('../src/llm/index.js')); } catch (_) { initLlm = null; }

// Pro 激活校验模块（Rust 原生 RSA 验签）
const license = require('../src/license/index.js');

// 本地控制面板服务（127.0.0.1，开发者侧签发密钥 / 监控日活 / 登入登出记录）
let startPanel = null;
try { ({ startPanel } = require('../src/panel/index.js')); } catch (_) { startPanel = null; }

// 遥测（登入/登出/日活上报，本机 JSONL + 本地面板推送）
const telemetry = require('../src/telemetry/index.js');

// 截图验证模式：启动后自动截取各页面画面并退出（用于自动化验证渲染）
const SCREENSHOT_MODE = process.env.SHOTSCRIPT_SCREENSHOT === '1';
const APP_ROOT = path.join(__dirname, '..');

// 截图验证模式用激活码：从环境变量或开发示例码文件读取（仅用于联调截图，非业务校验）
function screenshotActivationCode() {
  if (process.env.SHOTSCRIPT_ACTIVATION_CODE) return process.env.SHOTSCRIPT_ACTIVATION_CODE;
  try {
    return fs.readFileSync(path.join(APP_ROOT, 'rust', 'keys', 'example-code.txt'), 'utf-8').split('\n')[0].trim();
  } catch (_) {
    return '';
  }
}

/** 创建主窗口 */
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 700,
    title: 'ShotScript 剧本工坊',
    // ---- macOS 苹果玻璃质感：vibrancy 毛玻璃 + 无边框内嵌标题栏 ----
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 截图验证模式：等渲染完成后逐一截取各功能页
  if (SCREENSHOT_MODE) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          // 截图模式：清除持久化激活状态，确保门控图展示"未激活"态
          license.clearStore();
          // 同步重置渲染进程激活标志（防止启动时 restoreActivation 读到残留状态导致门控提前解锁）
          await win.webContents.executeJavaScript(`(() => {
            window.__SHOTSCRIPT_PRO_ACTIVE = false;
            if (window.__SHOTSCRIPT_PRO_UI && window.__SHOTSCRIPT_PRO_UI.applyGate) window.__SHOTSCRIPT_PRO_UI.applyGate();
            if (window.__SHOTSCRIPT_LLM_UI && window.__SHOTSCRIPT_LLM_UI.applyGate) window.__SHOTSCRIPT_LLM_UI.applyGate();
            return true;
          })()`);
          await new Promise((r) => setTimeout(r, 300));
          // 页面 id -> 输出文件名
          const pages = [
            ['page-templates', 'screenshot-template.png'],
            ['page-compress', 'screenshot-compress.png'],
            ['page-storyboard', 'screenshot-storyboard.png'],
            ['page-pro', 'screenshot-pro.png'],
            ['page-llm', 'screenshot-llm.png'],
            ['page-about', 'screenshot-about.png'],
          ];
          for (const [pageId, fileName] of pages) {
            await win.webContents.executeJavaScript(`(() => {
              document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
              document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
              const btn = document.querySelector('.nav-item[data-page="${pageId}"]');
              const page = document.getElementById('${pageId}');
              if (btn) btn.classList.add('active');
              if (page) page.classList.add('active');
              return true;
            })()`);
            await new Promise((r) => setTimeout(r, 600));
            if (pageId === 'page-pro') {
              // 未激活：先截一张"Pro专属遮罩"门控图
              const gateImg = await win.webContents.capturePage();
              fs.writeFileSync(path.join(APP_ROOT, 'screenshot-pro-gate.png'), gateImg.toPNG());
              console.log('[shotscript] 截图已保存: screenshot-pro-gate.png');
              // 本地润色页门控图（激活前）
              await win.webContents.executeJavaScript(`(() => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                const b = document.querySelector('.nav-item[data-page="page-llm"]');
                const p = document.getElementById('page-llm');
                if (b) b.classList.add('active');
                if (p) p.classList.add('active');
                return true;
              })()`);
              await new Promise((r) => setTimeout(r, 400));
              const llmGateImg = await win.webContents.capturePage();
              fs.writeFileSync(path.join(APP_ROOT, 'screenshot-llm-gate.png'), llmGateImg.toPNG());
              console.log('[shotscript] 截图已保存: screenshot-llm-gate.png');

              // ===================== 纯净模式四态验证（未激活态） =====================
              // 态②：开启纯净模式 → 侧边栏纯净 / 无门控 / 设置页开关
              await win.webContents.executeJavaScript(`(() => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                const b = document.querySelector('.nav-item[data-page="page-settings"]');
                const p = document.getElementById('page-settings');
                if (b) b.classList.add('active');
                if (p) p.classList.add('active');
                return true;
              })()`);
              await new Promise((r) => setTimeout(r, 400));
              await win.webContents.executeJavaScript(`(() => {
                const t = document.getElementById('pureModeToggle');
                if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event('change')); }
                return true;
              })()`);
              await new Promise((r) => setTimeout(r, 400));
              const pureSettingsImg = await win.webContents.capturePage();
              fs.writeFileSync(path.join(APP_ROOT, 'screenshot-pure-settings.png'), pureSettingsImg.toPNG());
              console.log('[shotscript] 截图已保存: screenshot-pure-settings.png');
              // 态②：切回固定模板页验证侧边栏纯净（无 Pro 徽标/入口）
              await win.webContents.executeJavaScript(`(() => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                const b = document.querySelector('.nav-item[data-page="page-templates"]');
                const p = document.getElementById('page-templates');
                if (b) b.classList.add('active');
                if (p) p.classList.add('active');
                return true;
              })()`);
              await new Promise((r) => setTimeout(r, 400));
              const pureNavImg = await win.webContents.capturePage();
              fs.writeFileSync(path.join(APP_ROOT, 'screenshot-pure-nav.png'), pureNavImg.toPNG());
              console.log('[shotscript] 截图已保存: screenshot-pure-nav.png');
              // 态②：Pro 页无门控遮罩、功能锁定（入口隐藏后直接 URL 级验证也保持锁定）
              await win.webContents.executeJavaScript(`(() => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                const b = document.querySelector('.nav-item[data-page="page-pro"]');
                const p = document.getElementById('page-pro');
                if (b) b.classList.add('active');
                if (p) p.classList.add('active');
                return true;
              })()`);
              await new Promise((r) => setTimeout(r, 400));
              const pureProImg = await win.webContents.capturePage();
              fs.writeFileSync(path.join(APP_ROOT, 'screenshot-pure-pro.png'), pureProImg.toPNG());
              console.log('[shotscript] 截图已保存: screenshot-pure-pro.png');
              // 态③：纯净模式下设置页激活入口低调可达 → 输入激活码激活并验证可用
              await win.webContents.executeJavaScript(`(() => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                const b = document.querySelector('.nav-item[data-page="page-settings"]');
                const p = document.getElementById('page-settings');
                if (b) b.classList.add('active');
                if (p) p.classList.add('active');
                return true;
              })()`);
              await new Promise((r) => setTimeout(r, 300));
              const pureActCode = screenshotActivationCode();
              await win.webContents.executeJavaScript(`(() => {
                document.getElementById('settingsActivateInput').value = ${JSON.stringify(pureActCode)};
                document.getElementById('settingsActivateBtn').click();
                return true;
              })()`);
              // 等待激活完成（Rust 原生验签异步）
              for (let i = 0; i < 20; i++) {
                const active = await win.webContents.executeJavaScript('window.__SHOTSCRIPT_PRO_ACTIVE === true');
                if (active) break;
                await new Promise((r) => setTimeout(r, 200));
              }
              await new Promise((r) => setTimeout(r, 300));
              const pureActivatedImg = await win.webContents.capturePage();
              fs.writeFileSync(path.join(APP_ROOT, 'screenshot-pure-activated.png'), pureActivatedImg.toPNG());
              console.log('[shotscript] 截图已保存: screenshot-pure-activated.png');
              // 态④：关闭纯净模式 → 恢复全部 Pro 推广触点与门控（已激活，Pro 入口回归）
              await win.webContents.executeJavaScript(`(() => {
                const t = document.getElementById('pureModeToggle');
                if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event('change')); }
                return true;
              })()`);
              await new Promise((r) => setTimeout(r, 300));
              await win.webContents.executeJavaScript(`(() => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                const b = document.querySelector('.nav-item[data-page="page-templates"]');
                const p = document.getElementById('page-templates');
                if (b) b.classList.add('active');
                if (p) p.classList.add('active');
                return true;
              })()`);
              await new Promise((r) => setTimeout(r, 300));
              const pureRestoreImg = await win.webContents.capturePage();
              fs.writeFileSync(path.join(APP_ROOT, 'screenshot-pure-restore.png'), pureRestoreImg.toPNG());
              console.log('[shotscript] 截图已保存: screenshot-pure-restore.png');
              // ===================== 纯净模式验证结束 =====================

              // 激活（真实 RSA 激活码）再触发演示生成
              const actCode = screenshotActivationCode();
              await win.webContents.executeJavaScript(`(() => {
                document.getElementById('activateInput').value = ${JSON.stringify(actCode)};
                document.getElementById('activateBtn').click();
                return true;
              })()`);
              // 等待激活完成（激活校验走 IPC + Rust 原生验签，为异步）
              for (let i = 0; i < 20; i++) {
                const active = await win.webContents.executeJavaScript('window.__SHOTSCRIPT_PRO_ACTIVE === true');
                if (active) break;
                await new Promise((r) => setTimeout(r, 200));
              }
              await new Promise((r) => setTimeout(r, 300));
              await win.webContents.executeJavaScript(`(() => {
                const btn = document.getElementById('proGenBtn');
                if (btn) { document.getElementById('proGenCount').value = '3'; btn.click(); }
                return true;
              })()`);
              await new Promise((r) => setTimeout(r, 400));
              // 回到 page-pro 再截图
              await win.webContents.executeJavaScript(`(() => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                const b = document.querySelector('.nav-item[data-page="page-pro"]');
                const p = document.getElementById('page-pro');
                if (b) b.classList.add('active');
                if (p) p.classList.add('active');
                return true;
              })()`);
              await new Promise((r) => setTimeout(r, 300));
            }
            if (pageId === 'page-llm') {
              // 激活态：演示一次（假引擎）润色，展示对照结果
              await win.webContents.executeJavaScript(`(() => {
                document.getElementById('llmInput').value = '大家好，今天给大家分享一个特别好用的方法，这个方法真的超级好用，大家一定要试试，我觉得效果非常非常明显。';
                document.getElementById('llmInstruction').value = 'colloquial';
                document.getElementById('llmTemperature').value = '0.7';
                document.getElementById('llmPolishBtn').click();
                return true;
              })()`);
              await new Promise((r) => setTimeout(r, 1600));
            }
            const image = await win.webContents.capturePage();
            fs.writeFileSync(path.join(APP_ROOT, fileName), image.toPNG());
            console.log('[shotscript] 截图已保存:', path.join(APP_ROOT, fileName));
          }
        } catch (err) {
          console.error('[shotscript] 截图失败:', err.message);
        } finally {
          // 截图模式收尾：无论成败一律清除激活残留，防止后续正常启动被自动解锁
          try { license.clearStore(); } catch (_) { /* ignore */ }
          app.quit();
        }
      }, 3000);
    });
  }

  return win;
}

/** 保存文本文件（渲染进程"导出分镜/文稿/Pro模板"用，支持 txt/md/srt 多格式） */
ipcMain.handle('save-text-file', async (_event, { defaultName, content, extension }) => {
  const ext = String(extension || 'txt').toLowerCase().replace(/^\./, '');
  const filterMap = {
    txt: { name: '文本文件', extensions: ['txt'] },
    md: { name: 'Markdown', extensions: ['md'] },
    markdown: { name: 'Markdown', extensions: ['md', 'markdown'] },
    srt: { name: '字幕文件', extensions: ['srt'] }
  };
  const filter = filterMap[ext] || { name: '文本文件', extensions: ['txt'] };
  const baseName = defaultName || ('shotscript-export.' + (filterMap[ext] ? ext : 'txt'));
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出为 ' + filter.name,
    defaultPath: path.join(app.getPath('documents'), baseName),
    filters: [filter]
  });
  if (canceled || !filePath) return { ok: false, path: null };
  fs.writeFileSync(filePath, content, 'utf-8');
  return { ok: true, path: filePath };
});

/** 从剪贴板读取（用于粘贴辅助） */
ipcMain.handle('clipboard-read', () => clipboard.readText());

// 打开本地控制面板（127.0.0.1:17680），用系统默认浏览器访问
ipcMain.handle('panel:open', async () => {
  const { shell } = require('electron');
  try {
    await shell.openExternal('http://127.0.0.1:17680');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  // 极简 macOS 原生菜单：隐藏默认菜单，保留编辑快捷键能力
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu', label: 'ShotScript' },
      { role: 'editMenu', label: '编辑' },
      { role: 'viewMenu', label: '视图' },
      { role: 'windowMenu', label: '窗口' }
    ]));
  }

  // 初始化 Pro 激活校验模块（Rust 原生 RSA 验签 + 状态持久化 + 启动自动复验 + 设备绑定）
  const licenseApi = license.initLicense();

  // 启动本地控制面板服务（127.0.0.1:17680，签发密钥 / 日活监控 / 登入登出记录）
  if (startPanel) {
    try { startPanel(); } catch (err) { console.error('[panel] 控制面板启动失败:', err.message); }
  }

  // 初始化本地 AI 润色模块（注册 IPC + 内存自适应选档 + 模型探测）
  initLlm();

  // 用户唯一 ID（开源免费版同样分配）+ 启动遥测：
  // 登录(code 1) 与 活跃(code 3) 对所有用户上报，不限于 Pro 激活；
  // Pro 激活成功由 license:verify 另行上报登录。
  try {
    telemetry.ensureUid();
    if (telemetry.reportLogin) telemetry.reportLogin(null, { mode: 'launch' });
    if (telemetry.reportActive) telemetry.reportActive();
  } catch (_) { /* ignore */ }

  // 启动自动复验：已激活则保持 Pro 态（激活本身由 license:verify 上报，不再重复上报）
  try {
    licenseApi.restoreActivation();
  } catch (_) { /* ignore */ }

  // 应用进程退出（被关闭）时上报 code 4 = 退出（不再活跃）
  app.on('will-quit', () => {
    try {
      if (telemetry.reportQuit) telemetry.reportQuit();
    } catch (_) { /* ignore */ }
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
