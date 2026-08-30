/**
 * ShotScript 剧本工坊 - 预加载脚本
 * 通过 contextBridge 向渲染进程暴露受限的桌面能力（复制/导出/平台信息/本地 AI 润色）
 */
const { contextBridge, ipcRenderer, clipboard } = require('electron');

/** 订阅主进程事件：返回清理函数 */
function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('shotscript', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  /** 写入剪贴板 */
  copyText: (text) => clipboard.writeText(text),
  /** 读取剪贴板 */
  readClipboard: () => ipcRenderer.invoke('clipboard-read'),
  /** 弹出保存对话框导出文本文件 */
  saveTextFile: (payload) => ipcRenderer.invoke('save-text-file', payload),
  /** ===== Pro 激活（Rust 原生 RSA 验签）===== */
  license: {
    /** 提交激活码校验，成功则持久化激活状态 */
    verify: (code) => ipcRenderer.invoke('license:verify', code),
    /** 查询当前激活状态（主进程启动自动复验） */
    getStatus: () => ipcRenderer.invoke('license:get-status')
  },
  /** ===== 本地 AI 润色（Pro）===== */
  llm: {
    /** 查询模型状态 */
    getStatus: () => ipcRenderer.invoke('llm:get-status'),
    /** 开始下载模型 */
    startDownload: () => ipcRenderer.invoke('llm:start-download'),
    /** 取消下载 */
    cancelDownload: () => ipcRenderer.invoke('llm:cancel-download'),
    /** 触发一次润色推理 */
    polish: (payload) => ipcRenderer.invoke('llm:polish', payload),
    /** 取消进行中的推理 */
    cancelPolish: () => ipcRenderer.invoke('llm:cancel-polish'),
    /** 订阅状态变化 */
    onStatus: (cb) => subscribe('llm:status', cb),
    /** 订阅下载进度 */
    onDownloadProgress: (cb) => subscribe('llm:download-progress', cb),
    /** 订阅润色流式 token */
    onPolishToken: (cb) => subscribe('llm:polish-token', cb),
    /** 订阅润色完成 */
    onPolishDone: (cb) => subscribe('llm:polish-done', cb),
    /** 订阅润色错误 */
    onPolishError: (cb) => subscribe('llm:polish-error', cb)
  }
});
