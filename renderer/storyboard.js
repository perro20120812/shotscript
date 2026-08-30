/**
 * ShotScript 剧本工坊 · 规则分镜模块（storyboard.js）
 * =====================================================
 * 纯规则、不依赖任何模型：把口播稿按句子拆分，结合规则判定镜头类型，
 * 生成分镜表（镜头号 / 画面建议 / 景别 / 时长建议 / 口播文案）。
 */

/** 镜头类型规则定义 */
const SHOT_RULES = [
  {
    type: '开场', badge: 't-open',
    test: (s) => /^(嗨|哈喽|hello|hi|大家好|各位|朋友们|欢迎|hey|hey[，,！! ])/i.test(s.trim()) || /(大家好|欢迎来到|回到频道)/.test(s.slice(0, 12)),
    shot: '中景 · 人像居中，微笑正视镜头，自然开场',
    timing: '2s'
  },
  {
    type: '提问', badge: 't-question',
    test: (s) => /[？?]|^(为什么|怎么|如何|什么是|能不能|是不是|有没有|该不该|值不值得)/.test(s.trim()),
    shot: '特写 · 表情提问感，配合大字号字幕抛出问题',
    timing: '2s'
  },
  {
    type: '教学', badge: 't-teach',
    test: (s) => /(第一|第二|第三|首先|其次|然后|最后|步骤|方法|教程|注意|重点|关键|切记|核心)/.test(s) || /\d+\s*(步|个|条|点|秒|分钟)/.test(s),
    shot: '中景 + 屏幕录制/板书，标注关键步骤数字',
    timing: '5s'
  },
  {
    type: '案例', badge: 't-case',
    test: (s) => /(比如|例如|举个例子|举个栗子|像|以.*为例|我有个朋友|身边|之前我)/.test(s),
    shot: '近景 · 展示实物/图片/数据图表，增强可信度',
    timing: '4s'
  },
  {
    type: '情绪', badge: 't-emotion',
    test: (s) => /(真的|太|超|绝了|震撼|惊艳|离谱|神了|惊呆了|yyds|太好|超级|巨)/.test(s),
    shot: '特写 · 情绪放大，配 BGM 起伏与轻音效',
    timing: '2s'
  },
  {
    type: '引导', badge: 't-guide',
    test: (s) => /(关注|点赞|三连|收藏|订阅|评论|评论区|转发|下期|再见|拜拜|记得|别忘|支持)/.test(s),
    shot: '中景 · 手势引导，指向关注按钮/评论区，收束全片',
    timing: '3s'
  },
  {
    type: '解说', badge: 't-normal',
    test: () => true,
    shot: '中景 · 常规口播解说，配合主题 B-roll 素材',
    timing: '4s'
  }
];

/** 按标点拆句，保留句子及位置信息 */
function splitSentences(text) {
  const raw = text.replace(/\r\n/g, '\n').trim();
  const parts = [];
  let buffer = '';
  for (const ch of raw) {
    buffer += ch;
    if (/[。！？；!?;\n]/.test(ch)) {
      const t = buffer.trim();
      if (t) parts.push(t);
      buffer = '';
    }
  }
  const t = buffer.trim();
  if (t) parts.push(t);
  return parts;
}

/** 判定一句的镜头类型 */
function classifySentence(s) {
  for (const rule of SHOT_RULES) {
    if (rule.test(s)) return rule;
  }
  return SHOT_RULES[SHOT_RULES.length - 1]; // 兜底解说
}

/** 主入口：生成分镜表 */
function generateStoryboard(text) {
  const sentences = splitSentences(text);
  let totalSeconds = 0;
  const shots = sentences.map((s, idx) => {
    const rule = classifySentence(s);
    const secs = parseFloat(rule.timing) || 4;
    totalSeconds += secs;
    return {
      no: idx + 1,
      type: rule.type,
      badge: rule.badge,
      shot: rule.shot,
      timing: rule.timing,
      text: s,
      seconds: secs
    };
  });
  return { shots, totalSeconds };
}

/** 导出为纯文本分镜稿 */
function storyboardToText(result) {
  const lines = [];
  lines.push('ShotScript 规则分镜表');
  lines.push('='.repeat(40));
  lines.push(`镜头总数：${result.shots.length} ｜ 预估总时长：${result.totalSeconds}s（参考值）`);
  lines.push('');
  for (const sh of result.shots) {
    lines.push(`【镜头 ${sh.no}】${sh.type}镜头 ｜ 景别建议：${sh.shot} ｜ 时长建议：${sh.timing}`);
    lines.push(`  文案：${sh.text}`);
    lines.push('');
  }
  return lines.join('\n');
}
