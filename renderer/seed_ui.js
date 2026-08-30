/**
 * ShotScript 剧本工坊 · Pro 无限模板页交互（seed_ui.js）
 * 串联 seed_engine.js 的种子引擎 + 黄金3秒钩子强度体系：
 *   平台选择 / 生成模板 / 每日生长 / 占位符填充成稿 / 多平台批量导出
 * Pro 权限门控：复用 app.js 激活状态（window.__SHOTSCRIPT_PRO_ACTIVE）
 */
(function () {
  'use strict';

  const API = window.shotscript || {};
  const engine = window.__SHOTSCRIPT_SEED_ENGINE;

  const PLATFORM_KEYS = ['douyin', 'bilibili', 'xiaohongshu', 'youtube'];

  // 当前模板池（已通过质检的模板，供导出）
  const state = {
    platform: 'douyin',
    templates: []
  };

  /* ===================== 工具 ===================== */
  function $id(id) { return document.getElementById(id); }
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function highlightPlaceholders(text) {
    return escHtml(text).replace(/\{([^{}]*)\}/g, '<span class="placeholder-chip">{$1}</span>');
  }
  function flashBtn(btn, text) {
    const origin = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => { btn.textContent = origin; btn.disabled = false; }, 1200);
  }

  /* ===================== Pro 门控 ===================== */
  function isPro() { return !!(window.__SHOTSCRIPT_PRO_ACTIVE); }

  function applyGate() {
    const gate = $id('proGate');
    const content = $id('proContent');
    if (isPro()) {
      gate.hidden = true;
      content.hidden = false;
    } else if (window.__SHOTSCRIPT_PURE_MODE) {
      // 纯净模式：隐藏升级遮罩，功能保持锁定（内容不可见、无法触发）
      gate.hidden = true;
      content.hidden = true;
    } else {
      gate.hidden = false;
      content.hidden = true;
    }
  }

  function unlock() {
    window.__SHOTSCRIPT_PRO_ACTIVE = true;
    applyGate();
  }

  /* ===================== 平台选择 ===================== */
  function renderPlatformPicker() {
    const wrap = $id('proPlatformPicker');
    wrap.innerHTML = '';
    PLATFORM_KEYS.forEach((key) => {
      const rule = engine.platform_rules[key];
      const min = engine.min_hook[key] === 'S' ? '强制 S 级开场' : 'S+A 级开场';
      const el = document.createElement('div');
      el.className = 'platform-chip' + (key === state.platform ? ' active' : '');
      el.innerHTML =
        '<div class="pc-name">' + rule.name + '</div>' +
        '<div class="pc-desc">' + escHtml(rule.desc) + '</div>' +
        '<div class="pc-min"><span class="hook-tag tag-' + min.charAt(0) + '">' + min + '</span>' + escHtml(min) + '</div>';
      el.addEventListener('click', () => {
        state.platform = key;
        renderPlatformPicker();
      });
      wrap.appendChild(el);
    });
  }

  /* ===================== 生成模板 ===================== */
  function makeSeed() {
    return (Date.now() % 0x7fffffff) + Math.floor(Math.random() * 1000);
  }

  function runGenerate(count) {
    const results = [];
    let rejected = 0;
    for (let i = 0; i < count; i++) {
      const tpl = engine.generateTemplate(makeSeed(), state.platform);
      if (tpl.passed) results.push(tpl);
      else rejected++;
    }
    return { results, rejected, total: count };
  }

  function handleGenerate() {
    const countEl = $id('proGenCount');
    const count = Math.max(1, Math.min(20, parseInt(countEl.value, 10) || 5));
    const { results, rejected, total } = runGenerate(count);

    // 追加到模板池（生成结果仅沉淀通过项）
    state.templates = results.concat(state.templates);
    const msg = $id('proGenMsg');
    msg.textContent = '生成 ' + total + ' 个，通过质检 ' + results.length + ' 个' +
      (rejected > 0 ? '，弱开场/不合格淘汰 ' + rejected + ' 个' : '');
    msg.className = 'pro-gen-msg' + (rejected > 0 ? ' warn' : ' ok');
    renderResults();
    $id('proGrowCard').hidden = true;
  }

  /* ===================== 每日生长 ===================== */
  function handleGrow() {
    const growth = engine.simulateGrowth(1, 20, 20260829, PLATFORM_KEYS);
    const day = growth.daily[0];

    // 统计
    const stats = $id('proGrowStats');
    stats.innerHTML = '';
    [
      { k: '本日生成', v: day.total, s: '全新种子批量' },
      { k: '通过质检', v: day.passed, s: '黄金3秒 + 四维质检' },
      { k: '通过率', v: day.rate + '%', s: '真实统计' },
      { k: '今日新模板', v: growth.todayTemplates.length, s: '已沉淀进模板池' }
    ].forEach((b) => {
      const box = document.createElement('div');
      box.className = 'stat-box';
      box.innerHTML = '<div class="k">' + b.k + '</div><div class="v">' + b.v + '</div><div class="s">' + b.s + '</div>';
      stats.appendChild(box);
    });

    // 今日新模板列表
    const list = $id('proGrowToday');
    list.innerHTML = '';
    state.templates = growth.todayTemplates.concat(state.templates);
    growth.todayTemplates.forEach((tpl) => {
      const item = document.createElement('div');
      item.className = 'grow-today-item';
      item.innerHTML =
        '<span class="hook-tag tag-' + tpl.firstHookLevel + '">' + tpl.firstHookLevel + '</span>' +
        '<span class="gti-name">' + escHtml(tpl.title) + '</span>' +
        '<span class="gti-meta">' + tpl.platformName + ' · ' + tpl.score + ' 分</span>';
      list.appendChild(item);
    });

    $id('proGrowCard').hidden = false;
    renderResults();
  }

  /* ===================== 模板卡片渲染 ===================== */
  function renderResults() {
    const wrap = $id('proResults');
    wrap.innerHTML = '';
    if (state.templates.length === 0) {
      wrap.innerHTML = '<div class="card"><div class="muted">暂无模板，点击「生成模板」或「每日生长」开始。</div></div>';
      $id('proExportCard').hidden = true;
      return;
    }
    state.templates.forEach((tpl, idx) => {
      wrap.appendChild(renderCard(tpl, idx));
    });
    $id('proExportInfo').textContent = '当前共 ' + state.templates.length + ' 个模板（' +
      state.templates.map((t) => t.platformName).join(' / ') + '），导出为选中格式。';
    $id('proExportCard').hidden = false;
  }

  function renderCard(tpl, idx) {
    const card = document.createElement('div');
    card.className = 'pro-card';
    const structure = tpl.structure.map((s) =>
      '<span class="struct-item"><b>' + escHtml(s.method) + '</b>(' + escHtml(s.name) + ')</span>').join('<span class="struct-arrow">→</span>');

    card.innerHTML =
      '<div class="pro-card-head">' +
        '<div class="pro-card-title">' +
          '<span class="pc-no">#' + (idx + 1) + '</span>' +
          '<span class="tpl-platform" style="background:' + platformColor(tpl.platform) + '">' + escHtml(tpl.platformName) + '</span>' +
          '<span class="hook-tag tag-' + tpl.firstHookLevel + '">黄金3秒 ' + tpl.firstHookLevel + ' 级 · ' + escHtml(tpl.firstHookName) + '</span>' +
        '</div>' +
        '<div class="pro-card-score">' + tpl.score + ' 分</div>' +
      '</div>' +
      '<div class="pro-card-title-line">' + escHtml(tpl.title) + '</div>' +
      '<div class="pro-card-structure">' + structure + '</div>' +
      '<div class="pro-card-body">' + highlightPlaceholders(tpl.body) + '</div>' +
      '<div class="pro-card-placeholder" id="ph-' + idx + '"></div>' +
      '<div class="pro-card-actions">' +
        '<button class="btn btn-sm btn-primary" id="final-' + idx + '">生成口播稿</button>' +
        '<button class="btn btn-sm" id="copyFinal-' + idx + '">复制成稿</button>' +
        '<span class="muted" id="finalNote-' + idx + '"></span>' +
      '</div>' +
      '<div class="pro-card-final" id="finalBox-' + idx + '" hidden></div>';

    // 占位符输入
    const phBox = card.querySelector('#ph-' + idx);
    tpl.placeholders.forEach((ph) => {
      const field = document.createElement('div');
      field.className = 'ph-inline';
      field.innerHTML = '<label>' + escHtml(ph) + '</label><input type="text" data-key="' + escHtml(ph) + '" placeholder="填写' + escHtml(ph) + '" />';
      phBox.appendChild(field);
    });

    // 生成口播稿
    card.querySelector('#final-' + idx).addEventListener('click', () => {
      const values = {};
      card.querySelectorAll('#ph-' + idx + ' input').forEach((inp) => { values[inp.dataset.key] = inp.value; });
      const raw = fillTemplate(tpl.body, values);
      // 本地内容审核：命中敏感词替换为 ***
      let result = raw;
      let hits = [];
      if (window.__SHOTSCRIPT_FILTER) {
        const r = window.__SHOTSCRIPT_FILTER.sanitize(raw);
        result = r.text;
        hits = r.hits;
      }
      tpl.finalScript = result;
      const box = card.querySelector('#finalBox-' + idx);
      box.textContent = result;
      box.hidden = false;
      const note = card.querySelector('#finalNote-' + idx);
      note.textContent = hits.length
        ? '已生成 · 本地审核过滤 ' + window.__SHOTSCRIPT_FILTER.summary(hits)
        : '已生成';
    });

    // 复制成稿
    card.querySelector('#copyFinal-' + idx).addEventListener('click', () => {
      const box = card.querySelector('#finalBox-' + idx);
      const text = tpl.finalScript || box.textContent;
      if (!text) {
        card.querySelector('#finalNote-' + idx).textContent = '请先生成口播稿';
        return;
      }
      if (API.copyText) {
        API.copyText(text);
        flashBtn(card.querySelector('#copyFinal-' + idx), '已复制');
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => flashBtn(card.querySelector('#copyFinal-' + idx), '已复制'));
      }
    });

    return card;
  }

  function platformColor(key) {
    return { douyin: '#fe2c55', bilibili: '#00a1d6', xiaohongshu: '#ff2442', youtube: '#ff0000' }[key] || '#888';
  }

  function fillTemplate(text, values) {
    return text.replace(/\{([^{}]*)\}/g, (_, ph) => {
      const v = values[ph];
      return (v !== undefined && v !== null && String(v).trim() !== '') ? String(v).trim() : '{' + ph + '}';
    });
  }

  /* ===================== 导出 ===================== */
  function handleExport() {
    if (state.templates.length === 0) return;
    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    let content = '';
    let ext = format;
    let baseName = 'shotscript-pro-templates';
    if (format === 'txt') {
      content = exportToText(state.templates);
      ext = 'txt';
    } else if (format === 'markdown') {
      content = exportToMarkdown(state.templates);
      ext = 'md';
    } else if (format === 'srt') {
      content = exportToSrt(state.templates);
      ext = 'srt';
    }
    if (API.saveTextFile) {
      API.saveTextFile({ defaultName: baseName + '.' + ext, content: content, extension: ext })
        .then((res) => {
          if (res && res.ok) {
            flashBtn($id('proExportBtn'), '已导出');
          }
        });
    } else {
      $id('proExportInfo').textContent = '当前环境不支持文件导出（缺少主进程能力）。';
    }
  }

  /* ===================== 初始化 ===================== */
  document.addEventListener('DOMContentLoaded', () => {
    if (!engine) return;

    // Pro 门控
    applyGate();
    $id('proGateBtn').addEventListener('click', () => {
      document.querySelector('.pro-btn').click();
    });

    renderPlatformPicker();

    $id('proGenBtn').addEventListener('click', handleGenerate);
    $id('proGrowBtn').addEventListener('click', handleGrow);
    $id('proExportBtn').addEventListener('click', handleExport);

    // 暴露解锁接口（app.js 激活成功后调用）与门控刷新接口（纯净模式切换时调用）
    window.__SHOTSCRIPT_PRO_UI = { unlock: unlock, isPro: isPro, applyGate: applyGate };
  });
})();
