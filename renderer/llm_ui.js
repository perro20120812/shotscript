/**
 * ShotScript 剧本工坊 · 本地 AI 润色页交互（llm_ui.js）
 * 依赖 preload 暴露的 window.shotscript.llm API。
 * 职责：Pro 门控、模型状态展示、下载引导、润色触发（流式渲染）、对照与复制。
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const API = (window.shotscript && window.shotscript.llm) || null;

  // 状态缓存
  let status = { state: 'idle', model: null, memoryGB: 0, progress: 0, lastError: '' };
  let polishing = false;
  let polishedFull = '';
  let engineTag = ''; // 'real' | 'fake'

  const BADGE_MAP = {
    idle: { text: '未下载', cls: 'badge-idle' },
    downloading: { text: '下载中', cls: 'badge-down' },
    ready: { text: '可推理', cls: 'badge-ready' },
    fake: { text: '模拟推理', cls: 'badge-fake' },
    error: { text: '异常', cls: 'badge-err' }
  };

  function init() {
    if (!API) {
      const badge = $('#llmModelBadge');
      if (badge) { badge.textContent = '不可用'; badge.className = 'model-badge badge-err'; }
      return;
    }
    bindEvents();
    refreshStatus();
    // 订阅主进程推送
    API.onStatus && API.onStatus((s) => { status = s; renderStatus(); });
    API.onDownloadProgress && API.onDownloadProgress((info) => { renderDownloadProgress(info); });
    API.onPolishToken && API.onPolishToken(({ chunk }) => { appendToken(chunk); });
    API.onPolishDone && API.onPolishDone(({ full, engine }) => { onPolishDone(full, engine); });
    API.onPolishError && API.onPolishError(({ error }) => { onPolishError(error); });
  }

  function bindEvents() {
    $('#llmGateBtn').addEventListener('click', () => {
      if (window.__SHOTSCRIPT_PRO_UI && window.__SHOTSCRIPT_PRO_UI.openModal) {
        window.__SHOTSCRIPT_PRO_UI.openModal();
      } else if (document.getElementById('proUpgradeBtn')) {
        document.getElementById('proUpgradeBtn').click();
      }
    });

    $('#llmDownloadBtn').addEventListener('click', startDownload);
    $('#llmDownloadCancelBtn').addEventListener('click', cancelDownload);
    $('#llmPolishBtn').addEventListener('click', doPolish);
    $('#llmCancelBtn').addEventListener('click', cancelPolish);
    $('#llmCopyBtn').addEventListener('click', copyPolished);
    $('#llmReplaceBtn').addEventListener('click', replaceOriginal);
    $('#llmTemperature').addEventListener('input', (e) => {
      $('#llmTempVal').textContent = Number(e.target.value).toFixed(1);
    });
  }

  /** 拉取主进程状态 */
  async function refreshStatus() {
    if (!API || !API.getStatus) return;
    try {
      status = await API.getStatus();
      renderStatus();
    } catch (_) { /* ignore */ }
  }

  function renderStatus() {
    const badge = BADGE_MAP[status.state] || BADGE_MAP.idle;
    const el = $('#llmModelBadge');
    el.textContent = badge.text;
    el.className = 'model-badge ' + badge.cls;
    // 只展示能力状态徽章，不暴露任何底层模型/引擎名称

    // 下载中状态
    const downloading = status.state === 'downloading';
    $('#llmDownloadBtn').hidden = status.state === 'ready' || status.state === 'downloading' || status.state === 'fake';
    $('#llmDownloadCancelBtn').hidden = !downloading;
    $('#llmDownloadHint').hidden = !downloading;
    $('#llmDownloadBar').hidden = !downloading;
    if (downloading) {
      $('#llmDownloadHint').textContent = '正在下载模型，可随时取消，支持断点续传…';
      renderDownloadProgress({ percent: status.progress });
    }

    // 错误信息
    const errEl = $('#llmModelErr');
    if (status.lastError && (status.state === 'error' || status.state === 'idle')) {
      errEl.hidden = false;
      errEl.textContent = '模型状态异常：' + status.lastError;
    } else {
      errEl.hidden = true;
    }
  }

  function renderDownloadProgress(info) {
    const bar = $('#llmDownloadBar');
    const fill = $('#llmDownloadProgress');
    const hint = $('#llmDownloadHint');
    if (bar.hidden) bar.hidden = false;
    const pct = Math.min(100, Math.max(0, info.percent || 0));
    fill.style.width = pct + '%';
    fill.textContent = Math.round(pct) + '%';
    if (info.bytes && info.total) {
      hint.textContent =
        '正在下载模型 ' + fmtBytes(info.bytes) + ' / ' + fmtBytes(info.total) + '（' + Math.round(pct) + '%）';
    }
  }

  function fmtBytes(b) {
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    return Math.round(b) + ' B';
  }

  async function startDownload() {
    if (!API || !API.startDownload) return;
    try {
      await API.startDownload();
      refreshStatus();
    } catch (e) {
      alert('下载启动失败：' + (e && e.message));
    }
  }

  async function cancelDownload() {
    if (API && API.cancelDownload) await API.cancelDownload();
    refreshStatus();
  }

  async function doPolish() {
    if (!API || !API.polish) return;
    const text = $('#llmInput').value.trim();
    if (!text) { alert('请先粘贴需要润色的文案。'); return; }

    polishing = true;
    polishedFull = '';
    engineTag = '';
    $('#llmEngineTag').hidden = true;
    $('#llmCompareCard').hidden = false;
    $('#llmOriginal').textContent = text;
    $('#llmPolished').textContent = '';
    $('#llmPolishBtn').disabled = true;
    $('#llmCancelBtn').hidden = false;

    try {
      await API.polish({
        text,
        instruction: $('#llmInstruction').value,
        temperature: parseFloat($('#llmTemperature').value)
      });
    } catch (e) {
      onPolishError(e && e.message);
    }
  }

  function appendToken(chunk) {
    polishedFull += chunk || '';
    $('#llmPolished').textContent = polishedFull;
    // 自动滚动到底部
    const box = $('#llmPolished');
    box.scrollTop = box.scrollHeight;
  }

  function onPolishDone(full, engine) {
    polishing = false;
    // 本地内容审核：命中敏感词替换为 ***
    let hits = [];
    if (window.__SHOTSCRIPT_FILTER && full) {
      const r = window.__SHOTSCRIPT_FILTER.sanitize(full);
      full = r.text;
      hits = r.hits;
    }
    polishedFull = full || polishedFull;
    $('#llmPolished').textContent = polishedFull;
    $('#llmPolishBtn').disabled = false;
    $('#llmCancelBtn').hidden = true;
    if (hits.length) {
      const tag = $('#llmEngineTag');
      tag.hidden = false;
      tag.textContent = '本地审核过滤 ' + window.__SHOTSCRIPT_FILTER.summary(hits);
    } else if (engine === 'fake') {
      engineTag = 'fake';
      const tag = $('#llmEngineTag');
      tag.hidden = false;
      tag.textContent = '模拟润色（未加载真实模型）';
    } else if (engine === 'real') {
      engineTag = 'real';
    }
  }

  function onPolishError(error) {
    polishing = false;
    $('#llmPolishBtn').disabled = false;
    $('#llmCancelBtn').hidden = true;
    $('#llmPolished').textContent = '润色失败：' + (error || '未知错误');
  }

  async function cancelPolish() {
    if (API && API.cancelPolish) await API.cancelPolish();
    polishing = false;
    $('#llmPolishBtn').disabled = false;
    $('#llmCancelBtn').hidden = true;
  }

  function copyPolished() {
    if (!polishedFull) return;
    const copied = () => {
      const b = $('#llmCopyBtn');
      b.textContent = '已复制';
      setTimeout(() => { b.textContent = '复制润色稿'; }, 1200);
    };
    if (window.shotscript && window.shotscript.copyText) {
      window.shotscript.copyText(polishedFull);
      copied();
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(polishedFull).then(copied);
    }
  }

  function replaceOriginal() {
    if (!polishedFull) return;
    $('#llmInput').value = polishedFull;
    $('#llmOriginal').textContent = polishedFull;
  }

  /** 暴露给 app.js：激活成功后解锁本页（解除门控遮罩） */
  function unlock() {
    const gate = $('#llmGate');
    const content = $('#llmContent');
    if (gate) gate.hidden = true;
    if (content) content.hidden = false;
    refreshStatus();
  }

  /** Pro 门控：默认显示"升级遮罩"；纯净模式下隐藏遮罩且功能保持锁定；已激活则显示内容 */
  function applyGate() {
    const gate = $('#llmGate');
    const content = $('#llmContent');
    if (!gate || !content) return;
    if (window.__SHOTSCRIPT_PRO_ACTIVE) {
      gate.hidden = true;
      content.hidden = false;
    } else if (window.__SHOTSCRIPT_PURE_MODE) {
      // 纯净模式：不显示升级遮罩，功能保持锁定（内容不可见、无法触发）
      gate.hidden = true;
      content.hidden = true;
    } else {
      gate.hidden = false;
      content.hidden = true;
    }
  }

  /** 暴露给 app.js：打开 Pro 升级弹窗（gate 按钮复用）；纯净模式下不弹推广窗 */
  function openModal() {
    if (window.__SHOTSCRIPT_PURE_MODE && !window.__SHOTSCRIPT_PRO_ACTIVE) return;
    const up = document.getElementById('proUpgradeBtn');
    if (up) up.click();
  }

  // 注册全局，供 app.js 激活联动
  window.__SHOTSCRIPT_LLM_UI = { unlock, openModal, refresh: refreshStatus, applyGate };

  // 激活联动：若已激活（如刷新页面后），直接解锁；否则按门控展示（未激活显示遮罩）
  function autoUnlock() {
    if (window.__SHOTSCRIPT_PRO_ACTIVE) {
      unlock();
    } else {
      applyGate();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    autoUnlock();
  });
})();
