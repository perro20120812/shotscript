/**
 * ShotScript 剧本工坊 · 算法精简模块（compressor.js）
 * =====================================================
 * 纯 JS 重写 text_compressor.py 的压缩算法，零第三方依赖。
 *
 * 五大能力：
 *   1) 冗余清理   —— 删除口语填充词/口头禅/无意义修饰（分层词表）
 *   2) 重复合并   —— 识别并合并语义重复的句子/短语（Ratcliff-Obershelp 相似度）
 *   3) 句式压缩   —— 深度档压缩套话/过门结构，保留主干
 *   4) 信息保护   —— 专名/数字/术语/书名号/引号先遮蔽、压缩后逐项校验零丢失
 *   5) 压缩率控制 —— 按"删除安全性"贪心删除到目标保留率（85%/75%/60%）
 */

/* ---------------- 一、分层词表（priority 越低越"安全"、越先删） ---------------- */

const FILLER_WORDS = {
  name: '纯填充词', priority: 0,
  words: ['怎么说呢', '那个啥', '你知道吧', '你懂的', '对不对', '是吧', '对吧', '是不是啊', '是不是']
};
const FILLER_BOUNDED = {
  name: '单字语气词', priority: 0,
  words: ['嗯', '呃', '哎', '哎呀', '唉']
};
const HABIT_WORDS = {
  name: '口头禅', priority: 1,
  words: ['就是说', '其实吧', '其实', '说实话', '讲真的', '真的是', '真的', '确实', '的确',
          '讲道理', '有一说一', '说白了']
};
const CONNECTOR_WORDS = {
  name: '冗余连接词', priority: 2,
  words: ['然后呢', '然后', '接着', '于是', '所以说呢', '所以说', '那接下来', '接下来']
};
const HEDGE_WORDS = {
  name: '程度弱化词', priority: 3,
  words: ['非常', '特别', '极其', '极为', '相当', '十分', '超级', '比较', '有点', '有些',
          '稍微', '基本上', '大概', '差不多', '相对而言']
};
const SELF_REF_WORDS = {
  name: '自我引用', priority: 4,
  words: ['我觉得', '我认为', '我想说的是', '我想说', '在我看来', '以我的经验', '据我所知',
          '我个人认为', '我的理解是']
};
const PREFACE_WORDS = {
  name: '句式铺垫', priority: 5,
  words: ['也就是说', '换句话说', '简而言之', '总而言之', '问题来了', '那么问题来了',
          '我们可以看到', '可以发现', '大家注意', '记住一点', '你要知道', '我要说的是']
};
const SOFTENER_WORDS = {
  name: '收尾软化', priority: 7,
  words: ['等等之类的', '这样那样的', '之类的', '什么的', '等等']
};

// 特殊上下文边界模式 + 深度句式压缩（紧档位才触发）
const EXTRA_PATTERNS = [
  ['冗余连接词', 2, '那么(?=[，。！？；、\\s]|呢|问题|$)'],
  ['句式压缩', 8, '这本书的写法'],
  ['句式压缩', 8, '，希望对大家有帮助'],
  ['句式压缩', 8, '我们下期再见，拜拜'],
  ['句式压缩', 8, '好了，'],
  ['句式压缩', 8, '，不多不少'],
  ['句式压缩', 8, '给大家'],
  ['句式压缩', 8, '可以参考'],
  ['句式压缩', 8, '一定会'],
  ['句式压缩', 8, '比如'],
  ['句式压缩', 8, '你要'],
  ['句式压缩', 8, '你说的这些我都懂'],
  ['句式压缩', 8, '工具方面，'],
  ['句式压缩', 8, '这件事啊'],
  ['句式压缩', 8, '，会看到变化']
];

// 语义保留验证用的关键词清单
const KEYWORDS = ['短视频', '定位', '内容', '更新', '执行力', '目标', '系统', '方法', '观众', '平台', '涨粉'];

/* ---------------- 二、信息保护配置 ---------------- */

const PROTECTED_TERMS = [
  '剪映', '抖音', 'B站', '小红书', 'YouTube', '微信', '视频号', '公众号', 'ChatGPT', '快手'
];

const NUMBER_PATTERN = /\d+(?:\.\d+)?\s*(?:%|万|亿|千|百|十|个|元|块|年|月|日|天|周|号|倍|人|次|台|款|秒|分钟|小时|点|分|位|条|期|季)?/;
const QUOTE_PATTERN = /[\u300a\u300c\u300e\u201c"][^\u300b\u300d\u300f\u201d"]{1,60}[\u300b\u300d\u300f\u201d"]/;
const ENGLISH_PATTERN = /[A-Za-z][A-Za-z0-9_\-. ]*/;

/* ---------------- 三、工具函数 ---------------- */

/** Ratcliff-Obershelp 最长公共子串匹配（等价 difflib matching_blocks） */
function findLongestMatch(a, aLo, aHi, b, bLo, bHi) {
  let best = [aLo, bLo, 0];
  for (let i = aLo; i < aHi; i++) {
    for (let j = bLo; j < bHi; j++) {
      let k = 0;
      while (i + k < aHi && j + k < bHi && a[i + k] === b[j + k]) k++;
      if (k > best[2]) best = [i, j, k];
    }
  }
  return best;
}
function recursiveMatchLen(a, aLo, aHi, b, bLo, bHi) {
  if (aLo >= aHi || bLo >= bHi) return 0;
  const [i, j, k] = findLongestMatch(a, aLo, aHi, b, bLo, bHi);
  if (k === 0) return 0;
  return k
    + recursiveMatchLen(a, aLo, i, b, bLo, j)
    + recursiveMatchLen(a, i + k, aHi, b, j + k, bHi);
}
/** 字符串相似度 ratio()：2*匹配字符数 / 总长度 */
function similarity(x, y) {
  if (x.length + y.length === 0) return 1;
  return (2 * recursiveMatchLen(x, 0, x.length, y, 0, y.length)) / (x.length + y.length);
}

/** 归一化：去掉标点空白（用于重复句比较） */
function norm(s) {
  return s.replace(/[\s，。！？；、,\.!?;:：\u201c\u201d\u300a\u300b]/g, '');
}

/* ---------------- 四、压缩器 ---------------- */

class ShotScriptCompressor {
  constructor() {
    this.categories = [
      FILLER_WORDS, FILLER_BOUNDED, HABIT_WORDS, CONNECTOR_WORDS,
      HEDGE_WORDS, SELF_REF_WORDS, PREFACE_WORDS, SOFTENER_WORDS
    ];
    this.patterns = [];
    for (const cat of this.categories) {
      const sorted = cat.words.slice().sort((x, y) => y.length - x.length);
      if (cat.name === '单字语气词') {
        // 仅句首 / 标点相邻处，避免误删实义单字
        this.patterns.push([cat.name, cat.priority,
          new RegExp('(?:^|(?<=[，。！？；、,.!?;：]))\\s*(?:' + sorted.map(esc).join('|') +
                     ')\\s*(?=[，。！？；、,.!?;：]|$)', 'g')]);
      } else {
        this.patterns.push([cat.name, cat.priority,
          new RegExp(sorted.map(esc).join('|'), 'g')]);
      }
    }
    for (const [name, pri, patStr] of EXTRA_PATTERNS) {
      this.patterns.push([name, pri, new RegExp(patStr, 'g')]);
    }
  }

  /* -------- 信息保护：遮蔽 -------- */
  _maskProtected(text) {
    const spans = [];
    for (const t of PROTECTED_TERMS) {
      const re = new RegExp(esc(t), 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        spans.push([m.index, m.index + m[0].length, t]);
      }
    }
    let m;
    const numRe = new RegExp(NUMBER_PATTERN.source, 'g');
    while ((m = numRe.exec(text)) !== null) spans.push([m.index, m.index + m[0].length, m[0]]);
    const qRe = new RegExp(QUOTE_PATTERN.source, 'g');
    while ((m = qRe.exec(text)) !== null) spans.push([m.index, m.index + m[0].length, m[0]]);
    const eRe = new RegExp(ENGLISH_PATTERN.source, 'g');
    while ((m = eRe.exec(text)) !== null) spans.push([m.index, m.index + m[0].length, m[0]]);

    // 排序 + 合并重叠
    spans.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const [s, e, t] of spans) {
      if (merged.length && s < merged[merged.length - 1][1]) {
        const last = merged[merged.length - 1];
        if (e > last[1]) last[1] = e, last[2] += t;
      } else {
        merged.push([s, e, t]);
      }
    }

    // 相同文本复用同一占位符 id
    const idMap = new Map();
    const mapping = [];   // [[placeholder, original]]
    const parts = [];
    let last = 0;
    for (const [s, e, t] of merged) {
      parts.push(text.slice(last, s));
      if (!idMap.has(t)) {
        const i = idMap.size;
        idMap.set(t, i);
        mapping.push(['\x02' + i + '\x03', t]);
      }
      parts.push('\x02' + idMap.get(t) + '\x03');
      last = e;
    }
    parts.push(text.slice(last));
    return [parts.join(''), mapping];
  }

  _restore(masked, mapping) {
    let out = masked;
    for (const [ph, t] of mapping) out = out.split(ph).join(t);
    return out;
  }

  /* -------- 重复合并识别 -------- */
  _findDuplicates(masked) {
    const cands = [];
    // a) 相邻短语重复：X，X / X、X（X 为不含标点的 4~14 字片段）
    const re = /([^，。！？；、\s]{4,14})[，、]\1/g;
    let m;
    while ((m = re.exec(masked)) !== null) {
      const start = m.index + m[1].length;   // 从分隔符起删第二个
      cands.push([start, m.index + m[0].length, '重复合并', 6]);
    }
    // b) 相邻句子语义重复：归一化相似度 >= 0.86 取其一
    const segs = [];
    const segRe = /.+?(?:[。！？；!?;]|\n|$)/g;
    while ((m = segRe.exec(masked)) !== null) {
      if (m[0].trim()) segs.push([m.index, m.index + m[0].length, m[0]]);
    }
    for (let k = 0; k < segs.length - 1; k++) {
      const [s1, e1, t1] = segs[k];
      const [s2, e2, t2] = segs[k + 1];
      const n1 = norm(t1), n2 = norm(t2);
      if (n1.length < 5 || n2.length < 5) continue;
      if (similarity(n1, n2) >= 0.86) {
        if (n1.length >= n2.length) cands.push([s2, e2, '重复合并', 6]);
        else cands.push([s1, e1, '重复合并', 6]);
      }
    }
    return cands;
  }

  /* -------- 重叠消解：重叠候选保留最长者 -------- */
  _dedupOverlap(cands) {
    cands.sort((a, b) => a[0] - b[0]);
    const kept = [];
    for (const [s, e, cat, pri] of cands) {
      if (kept.length) {
        const [ls, le] = kept[kept.length - 1];
        if (s < le) {
          if ((e - s) > (le - ls)) kept[kept.length - 1] = [s, e, cat, pri];
          continue;
        }
      }
      kept.push([s, e, cat, pri]);
    }
    return kept;
  }

  /* -------- 贪心删除（压缩率控制） -------- */
  _spanDropsUniqueInfo(masked, s, e) {
    const seg = masked.slice(s, e);
    const ids = seg.match(/\x02(\d+)\x03/g) || [];
    for (const ph of ids) {
      // 统计整串中该占位符出现次数
      let count = 0, idx = -1;
      while ((idx = masked.indexOf(ph, idx + 1)) !== -1) count++;
      if (count <= 1) return true;
    }
    return false;
  }

  _applyGreedy(masked, cands, targetLen) {
    cands.sort((a, b) => (a[3] - b[3]) || ((b[1] - b[0]) - (a[1] - a[0])));
    const deleted = [];
    const stats = {};
    let cur = masked.length;
    for (const [s, e, cat, pri] of cands) {
      if (cur <= targetLen) break;
      if (masked.slice(s, e).indexOf('\x02') !== -1) {
        if (this._spanDropsUniqueInfo(masked, s, e)) continue;
      }
      // 与已删区间重叠则跳过
      if (deleted.some(([ds, de]) => !(e <= ds || s >= de))) continue;
      deleted.push([s, e]);
      deleted.sort((a, b) => a[0] - b[0]);
      cur -= (e - s);
      const st = stats[cat] || { count: 0, chars: 0 };
      st.count += 1;
      st.chars += (e - s);
      stats[cat] = st;
    }
    return [deleted, stats];
  }

  /* -------- 主入口 -------- */
  compress(text, targetRatio = 0.6) {
    text = (text || '').trim();
    if (!text) return null;
    const origLen = text.length;
    const targetLen = Math.max(1, Math.round(origLen * targetRatio));

    // 1) 信息保护：遮蔽
    let masked, mapping;
    [masked, mapping] = this._maskProtected(text);

    // 2) 收集删除候选
    let cands = [];
    for (const [name, pri, pat] of this.patterns) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(masked)) !== null) {
        cands.push([m.index, m.index + m[0].length, name, pri]);
        if (m.index === pat.lastIndex) pat.lastIndex++;  // 防零宽死循环
      }
    }
    cands = cands.concat(this._findDuplicates(masked));
    cands = this._dedupOverlap(cands);

    // 3) 贪心删除
    const [deleted, stats] = this._applyGreedy(masked, cands, targetLen);

    // 4) 重建 + 标点整理
    let out = '';
    let last = 0;
    for (const [s, e] of deleted) {
      out += masked.slice(last, s);
      last = e;
    }
    out += masked.slice(last);

    out = out.replace(/([，。！？；、,.!?;:：])\s*([，。！？；、,.!?;:：])/g, '$1');
    out = out.replace(/\s+/g, ' ');
    out = out.replace(/([，。！？；、,.!?;:：])\s+/g, '$1');
    let compressed = this._restore(out, mapping);
    compressed = compressed.replace(/^[，。、；：,.;: ]+/, '');
    compressed = compressed.replace(/[，。、；：,.;: ]+$/, '');
    compressed = compressed.trim();

    // 5) 信息保护校验
    const protectedKept = [], protectedLost = [];
    for (const [, t] of mapping) {
      (compressed.includes(t) ? protectedKept : protectedLost).push(t);
    }
    const kwKept = [], kwLost = [];
    for (const kw of KEYWORDS) {
      if (text.includes(kw)) (compressed.includes(kw) ? kwKept : kwLost).push(kw);
    }

    // 6) 被删内容可视化
    const deletedItems = deleted.map(([s, e]) => {
      const cat = cands.find(([cs, ce]) => cs === s && ce === e);
      return { category: cat ? cat[2] : '未知', text: this._restore(masked.slice(s, e), mapping), chars: e - s };
    });

    const keptRatio = origLen ? compressed.length / origLen : 0;
    return {
      original: text,
      compressed,
      targetRatio,
      keptRatio,
      originalLen: origLen,
      compressedLen: compressed.length,
      stats,
      protectedKept,
      protectedLost,
      keywordsKept: kwKept,
      keywordsLost: kwLost,
      deletedItems
    };
  }

  /** 一次输入多档位压缩 */
  compressMulti(text, ratios) {
    return ratios.map((r) => this.compress(text, r)).filter(Boolean);
  }
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------------- 全局单例 ---------------- */
window.__SHOTSCRIPT_COMPRESSOR = new ShotScriptCompressor();
