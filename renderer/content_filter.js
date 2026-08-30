/**
 * ShotScript 剧本工坊 · 本地内容审核层（content_filter.js）
 * =========================================================
 * 纯本地、零联网：在生成管线出口对所有产出文案做敏感词过滤。
 * 职责：
 *   1) 内置中英文敏感词库（按类别分组，独立可扩充）
 *   2) 命中检测 + 自动替换（***）
 *   3) 返回 { ok, hits, text }，前端据此提示"已过滤 N 处"
 *
 * 安全边界：本模块仅做文案层面的词级过滤，不涉及任何网络上报。
 */
(function () {
  'use strict';

  /* ======================================================================
   * 一、敏感词库（按类别分组）
   * 覆盖：低俗不雅 / 暴力威胁 / 违禁交易 / 人身攻击 / 色情低俗
   * 词库独立于此文件顶部，便于后续扩充维护（社区共建）。
   * 注意：收录以"通用违禁/低俗词"为主，避免误伤正常表达。
   * ====================================================================== */
  var WORD_BANK = {
    // ---- 低俗不雅 ----
    profanity: [
      '妈的', '妈逼', '妈b', '草泥马', '草你', '傻逼', '傻比', '煞笔', '沙雕', '废物',
      '操你', '操他', '干你', '滚你', '去你', '你妈的', '艹你', '日你', '肏', '屌',
      '妈的个', '狗日的', '王八蛋', '贱人', '婊子', '妓女', '嫖', '卖淫', 'porn',
      'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'dick', 'cunt', 'whore', 'bastard'
    ],
    // ---- 暴力威胁 ----
    violence: [
      '杀人', '灭口', '弄死你', '打死你', '砍死', '炸死', '撕票', '开枪', '捅死',
      'kill you', 'murder', 'shoot'
    ],
    // ---- 违禁交易 / 违法内容 ----
    illegal: [
      '毒品', '海洛因', '冰毒', '摇头丸', '大麻', '枪支', '买枪', '卖枪', '军火',
      '赌博', '赌场', '洗钱', '诈骗', '拐卖', '贩毒', '制毒', 'dupin', 'heroin'
    ],
    // ---- 人身攻击 / 歧视 ----
    abuse: [
      '黑鬼', '支那', '蠢货', '弱智', '智障', '白痴', '去死', '废物点心', '垃圾人',
      'nigger', 'retard', 'idiot', 'stupid', 'moron'
    ],
    // ---- 色情低俗 ----
    erotica: [
      '色情', 'av', '三级片', '黄片', '撸', '自慰', '手淫', '口交', '做爱', '性交',
      '裸照', '艳照', '偷拍', '约炮', '一夜情', '援交', 'sex', 'sexy', 'porno',
      'erotic', 'nude', 'naked'
    ]
  };

  /* ======================================================================
   * 二、编译（将词库编译为正则集合，仅执行一次）
   * ====================================================================== */
  function escapeReg(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  var COMPILED = (function () {
    var map = {};       // word -> category
    var all = [];
    Object.keys(WORD_BANK).forEach(function (cat) {
      WORD_BANK[cat].forEach(function (w) {
        map[w] = cat;
        all.push(escapeReg(w));
      });
    });
    // 长词优先，避免短词先命中导致长词失效
    all.sort(function (a, b) { return b.length - a.length; });
    return {
      map: map,
      regex: new RegExp(all.join('|'), 'gi')
    };
  })();

  /* ======================================================================
   * 三、核心 API
   * ====================================================================== */

  /** 检测并返回命中清单（不修改文本） */
  function detect(text) {
    if (!text) return { ok: true, hits: [], text: text };
    var hits = [];
    var re = new RegExp(COMPILED.regex.source, 'gi');
    var m;
    var seen = {};
    while ((m = re.exec(text)) !== null) {
      var w = m[0];
      if (!seen[w]) {
        seen[w] = true;
        hits.push({ word: w, category: COMPILED.map[w.toLowerCase()] || 'unknown' });
      }
      // 防止零宽匹配死循环
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return { ok: hits.length === 0, hits: hits, text: text };
  }

  /** 检测并替换（命中词替换为 ***） */
  function sanitize(text) {
    var d = detect(text);
    if (d.ok) return d;
    d.text = text.replace(COMPILED.regex, function (w) {
      var cat = COMPILED.map[w.toLowerCase()];
      // 替换为等长 *** 更整洁，统一用三个星号
      return '***';
    });
    return d;
  }

  /** 类别中文名 */
  var CAT_NAME = {
    profanity: '低俗不雅',
    violence: '暴力威胁',
    illegal: '违禁内容',
    abuse: '人身攻击',
    erotica: '色情低俗',
    unknown: '敏感词'
  };

  /** 供前端展示的命中摘要文本 */
  function summary(hits) {
    if (!hits || hits.length === 0) return '';
    var cats = {};
    hits.forEach(function (h) {
      var c = CAT_NAME[h.category] || '敏感词';
      cats[c] = (cats[c] || 0) + 1;
    });
    return Object.keys(cats).map(function (c) { return c + ' ' + cats[c] + ' 处'; }).join('、');
  }

  /* ======================================================================
   * 四、暴露全局接口
   * ====================================================================== */
  window.__SHOTSCRIPT_FILTER = {
    detect: detect,
    sanitize: sanitize,
    summary: summary,
    CAT_NAME: CAT_NAME,
    version: '0.1.0'
  };
})();
