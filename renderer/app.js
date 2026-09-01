/**
 * ShotScript 剧本工坊 · 渲染层主逻辑（app.js）
 * 串联：侧边栏导航 / 固定模板 / 算法精简 / 规则分镜 / Pro 升级弹窗
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const API = window.shotscript || {};
  const compressor = window.__SHOTSCRIPT_COMPRESSOR;
  const filter = window.__SHOTSCRIPT_FILTER;

  /* ===================== 本地内容审核 ===================== */
  /** 对文案做本地敏感词审核：命中即替换为 ***，并返回命中摘要 */
  function auditText(text) {
    if (!filter || !text) return { text: text || '', hits: [] };
    const r = filter.sanitize(text);
    return { text: r.text, hits: r.hits };
  }
  function auditNote(hits, prefix) {
    return hits && hits.length ? (prefix || '') + '本地审核：已过滤 ' + filter.summary(hits) + ' 的敏感词（已替换为 ***）。' : '';
  }
  /** 在卡片标题下插入审核提示条（已存在的先移除） */
  function attachAuditNote(cardEl, hits) {
    if (!cardEl) return;
    const old = cardEl.querySelector('.audit-note');
    if (old) old.remove();
    if (!hits || !hits.length) return;
    const note = document.createElement('div');
    note.className = 'audit-note';
    note.textContent = '本地审核：已过滤 ' + filter.summary(hits) + '（敏感词已替换为 ***）。';
    const title = cardEl.querySelector('.card-title');
    if (title && title.nextSibling) cardEl.insertBefore(note, title.nextSibling);
    else cardEl.insertBefore(note, cardEl.firstChild);
  }

  /* ===================== 侧边栏导航 ===================== */
  function setupNav() {
    const navBtns = $$('.nav-item');
    navBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        navBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        $$('.page').forEach((p) => p.classList.remove('active'));
        const target = document.getElementById(btn.dataset.page);
        if (target) target.classList.add('active');
      });
    });
  }

  /* ===================== 固定模板页 ===================== */
  let currentTemplate = SHOTSCRIPT_TEMPLATES[0];

  function renderTemplates() {
    const wrap = $('#templatePicker');
    wrap.innerHTML = '';
    SHOTSCRIPT_TEMPLATES.forEach((tpl) => {
      const el = document.createElement('div');
      el.className = 'tpl-card' + (tpl.id === currentTemplate.id ? ' active' : '');
      el.innerHTML =
        '<span class="tpl-platform" style="background:' + tpl.platformColor + '">' + tpl.platform + '</span>' +
        '<div class="tpl-name">' + tpl.name + '</div>' +
        '<div class="tpl-scene">' + tpl.scene + '</div>';
      el.addEventListener('click', () => selectTemplate(tpl));
      wrap.appendChild(el);
    });
  }

  function selectTemplate(tpl) {
    currentTemplate = tpl;
    renderTemplates();
    // 模板预览
    $('#templateMeta').textContent = tpl.platform + ' · ' + tpl.duration;
    $('#templateBody').innerHTML = renderTemplateBody(tpl.body);
    // 占位符填写区
    renderPlaceholders(extractPlaceholders(tpl.body));
    $('#templateResultCard').hidden = true;
  }

  function renderPlaceholders(keys) {
    const grid = $('#placeholderGrid');
    const card = $('#placeholderCard');
    grid.innerHTML = '';
    if (keys.length === 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    keys.forEach((key) => {
      const field = document.createElement('div');
      field.className = 'placeholder-field';
      field.innerHTML = '<label>' + key + '</label><input type="text" data-key="' + key + '" placeholder="请输入' + key + '" />';
      grid.appendChild(field);
    });
  }

  function collectPlaceholderValues() {
    const values = {};
    $$('#placeholderGrid input').forEach((inp) => {
      values[inp.dataset.key] = inp.value;
    });
    return values;
  }

  function setupTemplatePage() {
    selectTemplate(currentTemplate);

    $('#genBtn').addEventListener('click', () => {
      const values = collectPlaceholderValues();
      const raw = fillTemplate(currentTemplate.body, values);
      const audited = auditText(raw);
      $('#templateResult').textContent = audited.text;
      attachAuditNote($('#templateResultCard'), audited.hits);
      $('#templateResultCard').hidden = false;
    });

    $('#clearPlaceholdersBtn').addEventListener('click', () => {
      $$('#placeholderGrid input').forEach((inp) => { inp.value = ''; });
    });

    $('#copyTemplateBtn').addEventListener('click', () => {
      const text = $('#templateResult').textContent;
      if (!text) return;
      if (API.copyText) {
        API.copyText(text);
        flashBtn($('#copyTemplateBtn'), '已复制');
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => flashBtn($('#copyTemplateBtn'), '已复制'));
      }
    });
  }

  /* ===================== 算法精简页 ===================== */
  function setupCompressPage() {
    const input = $('#compressInput');
    input.addEventListener('input', () => {
      $('#inputCount').textContent = input.value.replace(/\s/g, '').length + ' 字';
    });

    $('#compressBtn').addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) {
        $('#compressResult').textContent = '请先粘贴口播稿。';
        $('#compressResultCard').hidden = false;
        return;
      }
      const ratio = parseFloat($('input[name="ratio"]:checked').value);
      const result = compressor.compress(text, ratio);
      if (!result) {
        $('#compressResult').textContent = '输入为空，无法压缩。';
        $('#compressResultCard').hidden = false;
        return;
      }
      const audited = auditText(result.compressed);
      $('#compressResult').textContent = audited.text;
      attachAuditNote($('#compressResultCard'), audited.hits);
      renderCompressStats(result);
      $('#compressResultCard').hidden = false;
    });

    $('#copyCompressBtn').addEventListener('click', () => {
      const text = $('#compressResult').textContent;
      if (!text) return;
      if (API.copyText) {
        API.copyText(text);
        flashBtn($('#copyCompressBtn'), '已复制');
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => flashBtn($('#copyCompressBtn'), '已复制'));
      }
    });
  }

  function renderCompressStats(r) {
    const wrap = $('#compressStats');
    wrap.innerHTML = '';
    const keptPct = (r.keptRatio * 100).toFixed(1);
    const removedPct = ((1 - r.keptRatio) * 100).toFixed(1);

    const base = [
      { k: '原文', v: r.originalLen, s: '字符' },
      { k: '压缩后', v: r.compressedLen, s: '字符' },
      { k: '保留率', v: keptPct + '%', s: '目标 ' + (r.targetRatio * 100) + '%' },
      { k: '删除占比', v: removedPct + '%', s: '精简力度' }
    ];
    base.forEach((b) => {
      const box = document.createElement('div');
      box.className = 'stat-box';
      box.innerHTML = '<div class="k">' + b.k + '</div><div class="v">' + b.v + '</div><div class="s">' + b.s + '</div>';
      wrap.appendChild(box);
    });

    // 类别统计
    const cats = Object.keys(r.stats).filter((c) => r.stats[c].count > 0);
    if (cats.length) {
      const box = document.createElement('div');
      box.className = 'stat-box';
      let detail = '';
      cats.forEach((c) => {
        detail += c + ' ' + r.stats[c].count + ' 处 / ' + r.stats[c].chars + ' 字<br/>';
      });
      box.innerHTML = '<div class="k">删除明细</div><div class="v" style="font-size:12px;line-height:1.6;">' + detail + '</div>';
      wrap.appendChild(box);
    }

    // 信息保护校验提示
    const lost = (r.protectedLost || []).length;
    const warn = document.createElement('div');
    warn.className = 'stat-box';
    warn.style.gridColumn = '1 / -1';
    warn.innerHTML = '<div class="k">信息保护校验</div>' +
      '<div class="v" style="font-size:12px;line-height:1.6;color:' + (lost === 0 ? '#5ee08c' : '#ff6b5e') + ';">' +
      (lost === 0
        ? '专名 / 数字 / 术语 ' + (r.protectedKept || []).length + ' 项全部保留，零丢失 ✓'
        : '有 ' + lost + ' 项保护信息丢失：' + r.protectedLost.join('、')) + '</div>';
    wrap.appendChild(warn);
  }

  /* ===================== 规则分镜页 ===================== */
  function setupStoryboardPage() {
    $('#storyBtn').addEventListener('click', () => {
      const text = $('#storyInput').value.trim();
      if (!text) {
        $('#storyResultCard').hidden = true;
        return;
      }
      const audited = auditText(text);
      const result = generateStoryboard(audited.text);
      renderStoryTable(result);
      attachAuditNote($('#storyResultCard'), audited.hits);
      $('#storySummary').textContent = result.shots.length + ' 个镜头 · 预估 ' + result.totalSeconds + 's';
      $('#storyResultCard').hidden = false;
    });

    $('#storyClearBtn').addEventListener('click', () => {
      $('#storyInput').value = '';
      $('#storyResultCard').hidden = true;
    });

    $('#exportStoryBtn').addEventListener('click', () => {
      const text = $('#storyInput').value.trim();
      if (!text) return;
      const audited = auditText(text);
      const result = generateStoryboard(audited.text);
      const content = storyboardToText(result);
      if (API.saveTextFile) {
        API.saveTextFile({ defaultName: 'shotscript-storyboard.txt', content: content })
          .then((res) => {
            if (res && res.ok) flashBtn($('#exportStoryBtn'), '已导出');
          });
      }
    });
  }

  function renderStoryTable(result) {
    const table = $('#storyTable');
    table.innerHTML =
      '<thead><tr><th>镜头</th><th>类型</th><th>画面建议</th><th>口播文案</th><th>时长</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    result.shots.forEach((sh) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="shot-no">' + sh.no + '</td>' +
        '<td class="shot-type"><span class="type-badge ' + sh.badge + '">' + sh.type + '</span></td>' +
        '<td>' + escHtml(sh.shot) + '</td>' +
        '<td>' + escHtml(sh.text) + '</td>' +
        '<td>' + sh.timing + '</td>';
      tbody.appendChild(tr);
    });
  }

  /* ===================== Pro 激活（Rust 原生 RSA 验签） ===================== */
  function formatExpDate(exp) {
    const d = new Date(exp * 1000);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /** 激活成功后的通用状态落位（激活弹窗 / 启动自动复验 共用） */
  function applyActivatedState(payload) {
    // 升级按钮状态
    $('#proUpgradeBtn').classList.add('activated');
    $('#proUpgradeBtn').querySelector('strong').textContent = 'Pro 已激活';
    $('#proUpgradeBtn').querySelector('small').textContent = '无限模板 · AI 润色 · 已解锁';
    // 记录激活信息（用户ID + 到期日，供关于页展示）
    window.__SHOTSCRIPT_LICENSE_INFO = payload || null;
    // 联动解锁 Pro 无限模板页
    window.__SHOTSCRIPT_PRO_ACTIVE = true;
    if (window.__SHOTSCRIPT_PRO_UI && window.__SHOTSCRIPT_PRO_UI.unlock) {
      window.__SHOTSCRIPT_PRO_UI.unlock();
    }
    // 联动解锁 Pro 本地润色页
    if (window.__SHOTSCRIPT_LLM_UI && window.__SHOTSCRIPT_LLM_UI.unlock) {
      window.__SHOTSCRIPT_LLM_UI.unlock();
    }
    // 关于页授权状态刷新
    if (window.__SHOTSCRIPT_LICENSE_UI && window.__SHOTSCRIPT_LICENSE_UI.refresh) {
      window.__SHOTSCRIPT_LICENSE_UI.refresh();
    }
    // 设置页授权状态刷新
    if (window.__SHOTSCRIPT_SETTINGS_UI && window.__SHOTSCRIPT_SETTINGS_UI.refresh) {
      window.__SHOTSCRIPT_SETTINGS_UI.refresh();
    }
    // 已激活：纯净模式无实际影响（不隐藏 Pro 入口），重算生效态
    applyPureModeUI();
  }

  /** 错误码 -> 用户提示 */
  function licenseErrorText(res) {
    if (!res) return '激活校验失败，请稍后重试。';
    const map = {
      err_format: '激活码格式无效，请检查后重试。',
      err_parse: '激活码解析失败，请检查后重试。',
      err_signature: '激活码无效或已被篡改。',
      err_expired: '激活码已过期，请联系开发者续期。',
      err_native: '激活校验模块不可用，请重新安装应用。'
    };
    return map[res.code] || (res.message ? res.message : '激活失败，请重试。');
  }

  /* ===================== 设置页 & 纯净模式 ===================== */
  const PURE_MODE_KEY = 'shotscript.pureMode';

  function loadPureMode() {
    try { return localStorage.getItem(PURE_MODE_KEY) === '1'; } catch (_) { return false; }
  }
  function savePureMode(on) {
    try { localStorage.setItem(PURE_MODE_KEY, on ? '1' : '0'); } catch (_) {}
  }

  /**
   * 纯净模式：仅对未激活用户生效（隐藏全部 Pro 推广触点）；
   * 已激活用户开关无实际影响（保持兼容，不隐藏 Pro 入口）。
   */
  function applyPureModeUI() {
    const pure = window.__SHOTSCRIPT_PURE_MODE === true;
    const active = window.__SHOTSCRIPT_PRO_ACTIVE === true;
    // 仅未激活时挂 pure-mode 类：隐藏 nav-pro / pro-btn / pro-badge-lg / pro-gate / about-pro-block / proModal
    document.body.classList.toggle('pure-mode', pure && !active);
    // 设置页开关状态回显
    const toggle = $('#pureModeToggle');
    if (toggle) toggle.checked = pure;
    // 设置页纯净模式徽标
    const badge = $('#pureBadge');
    if (badge) badge.hidden = !pure;
    // 刷新 Pro 页门控（纯净模式下 gate 隐藏、content 保持锁定）
    if (window.__SHOTSCRIPT_PRO_UI && window.__SHOTSCRIPT_PRO_UI.applyGate) {
      window.__SHOTSCRIPT_PRO_UI.applyGate();
    }
    if (window.__SHOTSCRIPT_LLM_UI && window.__SHOTSCRIPT_LLM_UI.applyGate) {
      window.__SHOTSCRIPT_LLM_UI.applyGate();
    }
    // 纯净模式下强制关闭升级弹窗（防止残留）
    if (pure && !active) {
      const modal = $('#proModal');
      if (modal && !modal.hidden) modal.hidden = true;
    }
  }

  function setupSettingsPage() {
    // 纯净模式开关（默认关，持久化于 localStorage，与激活状态分离）
    const toggle = $('#pureModeToggle');
    if (toggle) {
      toggle.addEventListener('change', () => {
        window.__SHOTSCRIPT_PURE_MODE = toggle.checked;
        savePureMode(toggle.checked);
        applyPureModeUI();
      });
    }

    // 设置页授权信息（与关于页授权信息同步展示）
    const infoEl = $('#settingsLicenseInfo');
    if (infoEl) {
      const render = () => {
        const info = window.__SHOTSCRIPT_LICENSE_INFO;
        if (info && info.uid) {
          infoEl.innerHTML =
            'Pro 授权已激活<br/>用户 ' + escHtml(info.uid) +
            ' · 有效期至 ' + formatExpDate(info.exp) +
            '<br/><span class="muted">Rust 原生 RSA 签名校验</span>';
        } else {
          infoEl.innerHTML = 'Pro 未激活<br/><span class="muted">输入激活码即可解锁全部 Pro 功能</span>';
        }
        // 已激活才显示"退出登录"按钮（换机释放用）
        const logoutBtn = $('#settingsLogoutBtn');
        if (logoutBtn) logoutBtn.hidden = !(info && info.uid);
      };
      window.__SHOTSCRIPT_SETTINGS_UI = { refresh: render };
      render();
    }

    // 退出登录：清除本机激活 + 上报登出（旧设备释放，供换机到新设备）
    const logoutBtn = $('#settingsLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        if (!API.license || !API.license.logout) return;
        const ok = confirm('确认退出登录？本机 Pro 将恢复锁定状态。如需换机，请先在此设备退出，再到新设备用同一激活码激活。');
        if (!ok) return;
        try {
          await API.license.logout();
          window.__SHOTSCRIPT_PRO_ACTIVE = false;
          window.__SHOTSCRIPT_LICENSE_INFO = null;
          if (window.__SHOTSCRIPT_PRO_UI && window.__SHOTSCRIPT_PRO_UI.applyGate) window.__SHOTSCRIPT_PRO_UI.applyGate();
          if (window.__SHOTSCRIPT_LLM_UI && window.__SHOTSCRIPT_LLM_UI.applyGate) window.__SHOTSCRIPT_LLM_UI.applyGate();
          if (window.__SHOTSCRIPT_SETTINGS_UI) window.__SHOTSCRIPT_SETTINGS_UI.refresh();
          if (window.__SHOTSCRIPT_LICENSE_UI) window.__SHOTSCRIPT_LICENSE_UI.refresh();
          applyPureModeUI();
          $('#settingsActivateMsg').className = 'activate-msg ok';
          $('#settingsActivateMsg').textContent = '已退出登录，本机 Pro 已锁定。';
        } catch (err) {
          $('#settingsActivateMsg').className = 'activate-msg err';
          $('#settingsActivateMsg').textContent = '退出登录失败：' + (err && err.message ? err.message : '未知错误');
        }
      });
    }

    // 打开本地控制面板（127.0.0.1:17680，开发者侧：签发密钥 / 日活监控 / 登入登出）
    const panelBtn = $('#settingsOpenPanelBtn');
    if (panelBtn) {
      panelBtn.addEventListener('click', () => {
        if (API.openPanel) {
          API.openPanel();
        } else if (window.open) {
          window.open('http://127.0.0.1:17680', '_blank');
        }
      });
    }

    // 设置页低调激活入口（纯净模式下依然可达，不构成广告）
    const actBtn = $('#settingsActivateBtn');
    const actInput = $('#settingsActivateInput');
    const actMsg = $('#settingsActivateMsg');
    if (actBtn && actInput) {
      const doActivate = async () => {
        const code = actInput.value.trim();
        if (!code) {
          actMsg.className = 'activate-msg err';
          actMsg.textContent = '请输入激活码。';
          return;
        }
        actMsg.className = 'activate-msg';
        actMsg.textContent = '正在校验激活码…';
        if (!API.license || !API.license.verify) {
          actMsg.className = 'activate-msg err';
          actMsg.textContent = '当前环境缺少激活校验能力（主进程未就绪）。';
          return;
        }
        try {
          const res = await API.license.verify(code);
          if (res && res.ok && res.payload) {
            actMsg.className = 'activate-msg ok';
            actMsg.textContent = '激活成功！Pro 全部功能已解锁，有效期至 ' + formatExpDate(res.payload.exp) + '。';
            applyActivatedState(res.payload);
          } else {
            actMsg.className = 'activate-msg err';
            actMsg.textContent = licenseErrorText(res);
          }
        } catch (err) {
          actMsg.className = 'activate-msg err';
          actMsg.textContent = '激活校验异常：' + (err && err.message ? err.message : '未知错误');
        }
      };
      actBtn.addEventListener('click', doActivate);
      actInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doActivate(); });
    }

    // 暴露控制接口（供截图验证 / 测试调用）
    window.__SHOTSCRIPT_PURE_UI = {
      set(on) {
        window.__SHOTSCRIPT_PURE_MODE = !!on;
        savePureMode(!!on);
        applyPureModeUI();
        return window.__SHOTSCRIPT_PURE_MODE === true;
      },
      get() { return window.__SHOTSCRIPT_PURE_MODE === true; }
    };
  }

  function setupProModal() {
    const modal = $('#proModal');
    const open = () => {
      // 纯净模式（未激活）下不弹出升级窗，入口保持隐藏
      if (window.__SHOTSCRIPT_PURE_MODE === true && !window.__SHOTSCRIPT_PRO_ACTIVE) return;
      modal.hidden = false; $('#activateInput').focus();
    };
    const close = () => { modal.hidden = true; $('#activateMsg').textContent = ''; };

    $('#proUpgradeBtn').addEventListener('click', open);
    $('#proModalClose').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    $('#activateBtn').addEventListener('click', async () => {
      const code = $('#activateInput').value.trim();
      const msg = $('#activateMsg');
      if (!code) {
        msg.className = 'activate-msg err';
        msg.textContent = '请输入激活码。';
        return;
      }
      msg.className = 'activate-msg';
      msg.textContent = '正在校验激活码…';
      if (!API.license || !API.license.verify) {
        msg.className = 'activate-msg err';
        msg.textContent = '当前环境缺少激活校验能力（主进程未就绪）。';
        return;
      }
      try {
        const res = await API.license.verify(code);
        if (res && res.ok && res.payload) {
          msg.className = 'activate-msg ok';
          msg.textContent = '激活成功！Pro 全部功能已解锁，有效期至 ' + formatExpDate(res.payload.exp) + '。';
          applyActivatedState(res.payload);
          close();
        } else {
          msg.className = 'activate-msg err';
          msg.textContent = licenseErrorText(res);
        }
      } catch (err) {
        msg.className = 'activate-msg err';
        msg.textContent = '激活校验异常：' + (err && err.message ? err.message : '未知错误');
      }
    });

    // 回车触发激活
    $('#activateInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#activateBtn').click();
    });
  }

  /** 启动自动复验：查询主进程持久化激活状态，有效则直接解锁 */
  function restoreActivationOnStartup() {
    if (!API.license || !API.license.getStatus) return;
    API.license.getStatus().then((res) => {
      if (res && res.active && res.payload) {
        applyActivatedState(res.payload);
      }
    }).catch(() => { /* 复验失败保持未激活 */ });
  }

  /* ===================== 关于页 ===================== */
  function setupAboutPage() {
    const v = API.versions;
    if (v) {
      $('#aboutVersions').textContent =
        'Electron ' + v.electron + ' · Chromium ' + v.chrome + ' · Node ' + v.node +
        '（' + (API.platform || '') + '）';
    }

    // 授权状态展示（Pro 激活信息）
    const infoEl = $('#aboutLicenseInfo');
    if (!infoEl) return;
    const render = () => {
      const info = window.__SHOTSCRIPT_LICENSE_INFO;
      if (info && info.uid) {
        infoEl.innerHTML =
          'Pro 授权已激活<br/>用户 ' + escHtml(info.uid) +
          ' · 有效期至 ' + formatExpDate(info.exp) +
          '<br/><span class="muted">Rust 原生 RSA 签名校验</span>';
      } else {
        infoEl.innerHTML = 'Pro 未激活<br/><span class="muted">输入激活码即可解锁全部 Pro 功能</span>';
      }
    };
    // 激活状态变化时刷新
    window.__SHOTSCRIPT_LICENSE_UI = { refresh: render };
    render();
  }

  /* ===================== 工具函数 ===================== */
  function flashBtn(btn, text) {
    const origin = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = origin;
      btn.disabled = false;
    }, 1200);
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ===================== 启动 ===================== */
  document.addEventListener('DOMContentLoaded', () => {
    setupNav();
    setupTemplatePage();
    setupCompressPage();
    setupStoryboardPage();
    setupProModal();
    setupAboutPage();
    // 设置页 & 纯净模式：启动时恢复开关状态（默认关，与激活状态分离）
    window.__SHOTSCRIPT_PURE_MODE = loadPureMode();
    setupSettingsPage();
    applyPureModeUI();
    restoreActivationOnStartup();
  });
})();
