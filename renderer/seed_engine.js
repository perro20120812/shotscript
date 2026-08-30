/**
 * ShotScript 剧本工坊 · Pro 无限模板引擎（seed_engine.js）
 * =========================================================
 * 纯 JS 移植 temp/seed_template_engine 的"种子引擎 + 黄金3秒钩子强度体系"，
 * 零第三方依赖。
 *
 * 四大能力：
 *   1) 种子底库：8 大方法论结构块（AIDA/PAS/悬念/痛点前置/黄金圈/SCQA/口播节奏/平台适配）
 *   2) 种子驱动组合生成：同种子 + 同平台 => 结果可复现（伪随机 mulberry32）
 *   3) 黄金3秒钩子强度：开场块 S/A/B 分级，短视频平台强制 S 级开场，弱开场一票否决
 *   4) 四维质检：结构完整度评分 + 平台长度上下限 + 非法字符 + 占位符完整性
 *
 * 导出能力：文本/markdown/srt 三格式（srt 按句分配时间码）。
 */

/* ======================================================================
 * 一、伪随机数生成器（mulberry32）—— 保证"同种子可复现"
 * ====================================================================== */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ======================================================================
 * 二、种子底库（SEED_BANK）
 * 每个结构块：id/method/role/name/desc/text/platforms/weight/length
 * ====================================================================== */
const SEED_BANK = [
  // ---- AIDA（注意→兴趣→欲望→行动） ----
  { id: 'aida_attention', method: 'AIDA', role: 'opening', name: '注意力钩子',
    desc: '开场 3 秒制造认知缺口或反差，把用户从“划走”拉回来。',
    text: '开头 3 秒没抓住你，这条视频就输了。今天这个{topic}背后的秘密，可能颠覆你对{field}的认知。',
    platforms: ['all'], weight: 5, length: [20, 80] },
  { id: 'aida_interest', method: 'AIDA', role: 'body', name: '制造兴趣',
    desc: '给一个反常识结论并预告拆解路径，产生求知欲。',
    text: '先说结论：{claim}。这个结论和大多数人想的不一样。接下来我用{count}个要点拆给你看，看完你会回来感谢我。',
    platforms: ['all'], weight: 5, length: [25, 90] },
  { id: 'aida_desire', method: 'AIDA', role: 'body', name: '点燃欲望',
    desc: '描绘掌握方法后的收益画面，把“看视频”和“生活变好”建立连接。',
    text: '想象一下，当你真正掌握{skill}之后，{outcome}就不再靠运气，而是可以复制的日常。这正是这条视频要给你的东西。',
    platforms: ['all'], weight: 4, length: [25, 90] },
  { id: 'aida_action', method: 'AIDA', role: 'closing', name: '推动行动',
    desc: '明确给出下一步动作（关注/评论/领取资料）。',
    text: '如果这个思路对你有用，先点个关注，再在评论区打出{keyword}，我把{bonus}的整理版发给你。',
    platforms: ['all'], weight: 5, length: [20, 80] },

  // ---- PAS（问题→放大痛点→方案） ----
  { id: 'pas_problem', method: 'PAS', role: 'opening', name: '痛点点名',
    desc: '直接点名用户正在经历的痛点，制造“这不就是我吗”的代入感。',
    text: '你是不是也正在被{pain}折磨？评论区扣 1，让我看看有多少人中招。',
    platforms: ['all'], weight: 5, length: [15, 60] },
  { id: 'pas_agitate', method: 'PAS', role: 'body', name: '放大痛点',
    desc: '把问题拖延的后果说透，制造紧迫感。',
    text: '别小看这个坑，它每拖一天，你的{loss}就多损失一点；更糟的是，你还会在错误的方向上越走越远。',
    platforms: ['all'], weight: 4, length: [25, 85] },
  { id: 'pas_solution', method: 'PAS', role: 'body', name: '给出方案',
    desc: '把解法拆成可执行的步骤，给出“照做就行”的确定性。',
    text: '解决方案其实只有三步：第一步{step1}，第二步{step2}，第三步{step3}。照着做，问题就会开始松动。',
    platforms: ['all'], weight: 5, length: [25, 90] },

  // ---- 悬念钩子 ----
  { id: 'suspense_hook', method: '悬念钩子', role: 'opening', name: '悬念开场',
    desc: '用“可能会得罪人但还是要说”制造冲突悬念。',
    text: '这条视频可能会得罪不少人，但我还是要把{topic}的真相说出来。',
    platforms: ['all'], weight: 4, length: [15, 60] },
  { id: 'suspense_reveal', method: '悬念钩子', role: 'body', name: '揭晓反转',
    desc: '先立常见认知再推翻，用反转制造记忆点。',
    text: '你以为的{common_belief}，很可能是错的。真相是——{truth}。',
    platforms: ['all'], weight: 4, length: [15, 60] },
  { id: 'suspense_twist', method: '悬念钩子', role: 'body', name: '二次反转',
    desc: '揭晓后再留钩子，维持悬念张力。',
    text: '别急，故事还没完。真正的反转在后面：{twist}。',
    platforms: ['all'], weight: 3, length: [15, 55] },

  // ---- 痛点前置 ----
  { id: 'pain_empathy', method: '痛点前置', role: 'opening', name: '痛点共鸣开场',
    desc: '用“你最近也……”建立共情，让用户觉得“这条视频懂我”。',
    text: '如果你最近也在{struggle}，那这条视频就是专门为你准备的。',
    platforms: ['all'], weight: 4, length: [15, 55] },
  { id: 'pain_contrast', method: '痛点前置', role: 'body', name: '前后对比',
    desc: '用“以前的我 vs 现在的我”做对比，铺垫方法价值。',
    text: '以前我也一样，直到我把做法换成了{method}，结果完全不一样。区别只在三个细节。',
    platforms: ['all'], weight: 4, length: [25, 80] },
  { id: 'pain_result', method: '痛点前置', role: 'body', name: '结果画面',
    desc: '描绘问题解决后的收益，让“改变”变得可感知。',
    text: '当{problem}解决之后，你会发现自己每天省下的时间和精力，足够多做{extra}件事。',
    platforms: ['all'], weight: 3, length: [20, 70] },

  // ---- 黄金圈（Why→How→What） ----
  { id: 'golden_why', method: '黄金圈', role: 'opening', name: '为什么（Why）',
    desc: '以认知差距切入，回答“为什么这件事值得做”。',
    text: '为什么有人做{topic}轻松出结果，有人却越做越累？差距不在努力，而在认知。',
    platforms: ['all'], weight: 3, length: [20, 70] },
  { id: 'golden_how', method: '黄金圈', role: 'body', name: '怎么做（How）',
    desc: '把方法拆成可复制步骤，提供“可抄作业”的路径。',
    text: '具体怎么做？拆成三步：{step1} → {step2} → {step3}，每一步都有可以直接照抄的细节。',
    platforms: ['all'], weight: 5, length: [25, 85] },
  { id: 'golden_what', method: '黄金圈', role: 'body', name: '是什么（What）',
    desc: '用一句话给主题下定义，收束认知。',
    text: '说到底，{topic}的本质，就是把{core}这一件事做到极致，其余都是围绕它的补充。',
    platforms: ['all'], weight: 3, length: [20, 75] },

  // ---- SCQA（情境→冲突→疑问→回答） ----
  { id: 'scqa_situation', method: 'SCQA', role: 'opening', name: '情境铺垫',
    desc: '描述熟悉的客观背景，让后续冲突有落点。',
    text: '做{topic}的人越来越多，工具也越来越成熟，看起来是个人都能上手。',
    platforms: ['all'], weight: 3, length: [20, 70] },
  { id: 'scqa_complication', method: 'SCQA', role: 'body', name: '抛出冲突',
    desc: '指出“看似简单实则不然”的矛盾。',
    text: '但真正做出成绩的，不到 10%。问题到底出在哪里？',
    platforms: ['all'], weight: 4, length: [15, 55] },
  { id: 'scqa_question', method: 'SCQA', role: 'body', name: '引发疑问',
    desc: '替用户问出关键问题，并给反常识指向。',
    text: '答案可能和你想的不一样：卡住你的从来不是{tool}，而是{skill}这个基本功。',
    platforms: ['all'], weight: 4, length: [20, 70] },
  { id: 'scqa_answer', method: 'SCQA', role: 'closing', name: '给出回答',
    desc: '给出明确行动顺序建议，完成闭环。',
    text: '所以我的建议很直接：先把{foundation}打牢，再谈{direction}。顺序反了，事倍功半。',
    platforms: ['all'], weight: 4, length: [20, 75] },

  // ---- 口播节奏（开场/结尾） ----
  { id: 'oral_opening', method: '口播节奏', role: 'opening', name: '口播开场',
    desc: '一句话介绍自己 + 只讲一件事，明确视频承诺。',
    text: '大家好，我是{creator}。今天只讲一件事：{topic}。讲完就走，不拖泥带水。',
    platforms: ['all'], weight: 5, length: [20, 70] },
  { id: 'oral_question', method: '口播节奏', role: 'opening', name: '提问式开场',
    desc: '用直击用户的问题开场，把“看视频”变成“回答疑问”。',
    text: '你有没有想过，{question}？这个问题的答案，能帮你少走{amount}弯路。',
    platforms: ['all'], weight: 4, length: [20, 70] },
  { id: 'oral_transition', method: '口播节奏', role: 'body', name: '中段转场提示',
    desc: '提醒用户“重点来了”，重置注意力。',
    text: '好，前面讲的是背景，接下来才是重点。注意听这{count}个关键点。',
    platforms: ['all'], weight: 3, length: [15, 55] },
  { id: 'oral_summary', method: '口播节奏', role: 'closing', name: '结尾总结金句',
    desc: '三句话总结全文，形成记忆锚点。',
    text: '最后总结三句话：{point1}；{point2}；{point3}。觉得有用就点个赞，让更多人看到。',
    platforms: ['all'], weight: 5, length: [25, 85] },
  { id: 'oral_cta', method: '口播节奏', role: 'closing', name: '结尾引导互动',
    desc: '用“评论区扣关键词”收集互动信号。',
    text: '下一期我准备做{next_topic}，想看的人评论区扣{keyword}，人多我就安排。',
    platforms: ['all'], weight: 4, length: [20, 70] },

  // ---- 平台适配 ----
  { id: 'bilibili_opening', method: '平台适配', role: 'opening', name: 'B站·深度开场',
    desc: 'B站用户偏爱扎实内容：报时长、报承诺。',
    text: '大家好，这里是{channel}。今天用{minutes}分钟，把{topic}彻底讲透，看完你能直接上手。',
    platforms: ['bilibili'], weight: 5, length: [25, 85] },
  { id: 'bilibili_closing', method: '平台适配', role: 'closing', name: 'B站·三连收尾',
    desc: 'B站强“三连文化”，结尾引导点赞/投币/收藏。',
    text: '如果这期内容对你有帮助，三连支持一下，弹幕聊聊你的想法，我们下期见。',
    platforms: ['bilibili'], weight: 5, length: [20, 70] },
  { id: 'douyin_hook', method: '平台适配', role: 'opening', name: '抖音·前3秒钩子',
    desc: '抖音前 3 秒决定生死：直接抛结论/反常识，用“先别划走”对抗滑走。',
    text: '{topic}的真相，今天一次讲清楚。先别划走，看完再判断值不值得。',
    platforms: ['douyin'], weight: 5, length: [18, 60] },
  { id: 'douyin_closing', method: '平台适配', role: 'closing', name: '抖音·强关注引导',
    desc: '抖音强调“关注后持续获得价值”，结尾用干货承诺促关注。',
    text: '关注我，每天一个{direction}干货，划走的都后悔了。',
    platforms: ['douyin'], weight: 5, length: [15, 50] },
  { id: 'xhs_title', method: '平台适配', role: 'opening', name: '小红书·种草开场',
    desc: '小红书偏种草语境：感叹式开头 + 强收藏钩子。',
    text: '姐妹们！这个{topic}也太好用了，后悔没早点刷到，建议直接收藏。',
    platforms: ['xiaohongshu'], weight: 5, length: [20, 60] },
  { id: 'xhs_closing', method: '平台适配', role: 'closing', name: '小红书·收藏引导',
    desc: '“收藏”是核心行为指标，结尾引导收藏 + 评论区点菜。',
    text: '先收藏再看完，评论区告诉我你还想学{next_topic}的什么。',
    platforms: ['xiaohongshu'], weight: 5, length: [18, 55] },
  { id: 'youtube_intro', method: '平台适配', role: 'opening', name: 'YouTube·体系化开场',
    desc: 'YouTube 长视频讲究体系化：预告全程路径 + 保留彩蛋。',
    text: '欢迎回来。这期视频我们从零拆解{topic}，全程三步，看到最后有{bonus}彩蛋。',
    platforms: ['youtube'], weight: 5, length: [22, 70] },
  { id: 'youtube_cta', method: '平台适配', role: 'closing', name: 'YouTube·订阅收尾',
    desc: '核心指标是订阅与观看时长，结尾引导订阅 + 铃铛 + 提问。',
    text: '如果这期对你有帮助，点个订阅并打开小铃铛，方便第一时间收到更新。评论区留下你的问题。',
    platforms: ['youtube'], weight: 5, length: [25, 75] },
];

/* ======================================================================
 * 三、平台规则 + 钩子强度表
 * ====================================================================== */
const PLATFORM_RULES = {
  bilibili: { name: 'B站', desc: '中长视频（5-20 分钟），知识密度高，三连文化。', length_range: [60, 700] },
  douyin: { name: '抖音', desc: '短视频（15-60 秒），前 3 秒钩子决定生死，节奏快。', length_range: [25, 200] },
  xiaohongshu: { name: '小红书', desc: '图文+短视频混合，种草风，强收藏引导。', length_range: [30, 250] },
  youtube: { name: 'YouTube', desc: '长视频（8-20 分钟+），重视 SEO 与订阅转化。', length_range: [80, 900] },
};

/** 开场块钩子强度（S 最强 / A 中上 / B 弱） */
const HOOK_STRENGTH = {
  aida_attention: 'A',      // 反常识钩子，中上
  pas_problem: 'S',         // 痛点点名，强代入
  suspense_hook: 'S',       // 得罪人式悬念，强冲突
  pain_empathy: 'A',        // 共情式，中上
  golden_why: 'A',          // 反常识认知差，中上
  scqa_situation: 'B',      // 情境铺垫，弱（前3秒废）
  oral_opening: 'B',        // 自我介绍，弱
  oral_question: 'A',       // 提问式，中上
  bilibili_opening: 'B',    // 报时长承诺，B站长视频可接受
  douyin_hook: 'S',         // 先别划走 + 真相，强
  xhs_title: 'S',           // 种草感叹，强
  youtube_intro: 'B',       // 欢迎回来，弱（YT长视频可接受）
  // 视觉钩子（S）
  visual_result: 'S',       // 结果前置
  visual_contrast: 'S',     // 反差画面
};

/** 视觉化/结果前置 S 级钩子（画面感，直击 3 秒） */
const VISUAL_HOOKS = [
  { id: 'visual_result', method: '视觉钩子', role: 'opening', name: '结果前置（S）',
    desc: '开场直接亮出可视化结果/收益画面，让用户 1 秒内看到“看完我能得到什么”。',
    text: '{result}，我只用了{time}就做到了。方法今天全告诉你，看完你也能。这不是标题党，是真的。',
    platforms: ['all'], weight: 6, length: [20, 70] },
  { id: 'visual_contrast', method: '视觉钩子', role: 'opening', name: '反差画面（S）',
    desc: '用“同一件事，两种人两种命”的反差画面制造认知冲击。',
    text: '同样做{topic}，有人{good_outcome}，有人还在{bad_outcome}。差别就在下面这个动作。',
    platforms: ['all'], weight: 6, length: [20, 70] },
];

/** 平台允许的最低开场强度 */
const MIN_HOOK = { douyin: 'S', xiaohongshu: 'S', bilibili: 'A', youtube: 'A' };
const LEVEL_RANK = { S: 2, A: 1, B: 0 };

/* ======================================================================
 * 四、种子模板引擎
 * ====================================================================== */
class SeedEngine {
  constructor() {
    this.seed_bank = SEED_BANK.concat(VISUAL_HOOKS);
    this.platform_rules = PLATFORM_RULES;
    this.hook_strength = Object.assign({}, HOOK_STRENGTH);
    this.min_hook = MIN_HOOK;
  }

  /** 加权不放回抽取 n 个 */
  _pickWeighted(blocks, n, rng) {
    const pool = blocks.slice();
    const chosen = [];
    const k = Math.min(n, pool.length);
    for (let c = 0; c < k; c++) {
      const total = pool.reduce((s, b) => s + b.weight, 0);
      let r = rng() * total;
      let acc = 0, idx = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        acc += pool[i].weight;
        if (r <= acc) { idx = i; break; }
      }
      chosen.push(pool.splice(idx, 1)[0]);
    }
    return chosen;
  }

  /** 生成一个模板（同种子 + 同平台 => 同结果） */
  generateTemplate(seedValue, platform, rng) {
    rng = rng || mulberry32(seedValue);
    const plat = platform || ['douyin', 'bilibili', 'xiaohongshu', 'youtube'][Math.floor(rng() * 4)];
    const pool = this.seed_bank.filter((b) => b.platforms.indexOf('all') >= 0 || b.platforms.indexOf(plat) >= 0);

    // 开场块按平台最低强度过滤（S 平台只留 S，A 平台留 S+A）
    const minRank = LEVEL_RANK[this.min_hook[plat]];
    const openings = pool.filter((b) => b.role === 'opening' &&
      (LEVEL_RANK[this.hook_strength[b.id]] || 0) >= minRank);
    const bodies = pool.filter((b) => b.role === 'body');
    const closings = pool.filter((b) => b.role === 'closing');

    // 平台自适应块数
    const [lo, hi] = this.platform_rules[plat].length_range;
    const budget = (lo + hi) / 2;
    const target = Math.max(4, Math.min(8, Math.round(budget / 55)));
    const nOpen = 1 + Math.floor(rng() * 2);       // 1~2
    const nClose = 1 + Math.floor(rng() * 2);      // 1~2
    const nBody = Math.max(2, Math.min(4, target - nOpen - nClose));

    const chosen = this._pickWeighted(openings, nOpen, rng)
      .concat(this._pickWeighted(bodies, nBody, rng))
      .concat(this._pickWeighted(closings, nClose, rng));

    const first = chosen[0], last = chosen[chosen.length - 1];
    const title = this.platform_rules[plat].name + '｜' + first.name + ' × ' + last.name + ' 组合口播模板';
    const body = chosen.map((b) => b.text).join('\n\n');
    const structure = chosen.map((b) => ({ id: b.id, method: b.method, role: b.role, name: b.name, desc: b.desc, text: b.text }));

    const ev = this.evaluate(body, plat, structure);
    return {
      title, platform: plat, platformName: this.platform_rules[plat].name,
      structure, body, seed: seedValue,
      score: ev.score, passed: ev.passed, issues: ev.issues,
      firstHookId: first.id, firstHookLevel: this.hook_strength[first.id] || 'B',
      firstHookName: first.name, firstHookText: first.text,
      placeholders: extractPlaceholders(body)
    };
  }

  /** 四维质检 */
  evaluate(body, plat, structure) {
    const issues = [];
    let score = 0;
    const roles = structure.map((s) => s.role);
    const nOpen = roles.filter((r) => r === 'opening').length;
    const nBody = roles.filter((r) => r === 'body').length;
    const nClose = roles.filter((r) => r === 'closing').length;

    if (nOpen >= 1) score += 30; else issues.push('缺少开场块(opening)，结构不完整');
    score += Math.min(nBody, 3) * 12;
    if (nBody < 1) issues.push('缺少中段块(body)，内容空泛');
    if (nClose >= 1) score += 24; else issues.push('缺少结尾块(closing)，无法收束');
    const methods = new Set(structure.map((s) => s.method));
    if (methods.size >= 3) score += 10;
    else if (methods.size === 2) score += 5;
    score = Math.min(score, 100);

    if (nOpen < 1 || nBody < 1 || nClose < 1) {
      return { score: round1(score), passed: false, issues: issues.concat(['结构不完整，组合不合格']) };
    }

    // 长度上下限
    const [lo2, hi2] = this.platform_rules[plat].length_range;
    if (body.length < lo2) issues.push('正文过短 ' + body.length + ' 字 < 平台下限 ' + lo2);
    if (body.length > hi2) issues.push('正文过长 ' + body.length + ' 字 > 平台上限 ' + hi2);

    // 非法控制字符
    const ctl = body.split('').filter((c) => c.charCodeAt(0) < 32 && c !== '\n' && c !== '\t');
    if (ctl.length) issues.push('检测到非法控制字符 ' + ctl.length + ' 处');

    // 占位符完整性
    if ((body.match(/\{/g) || []).length !== (body.match(/\}/g) || []).length) issues.push('花括号不配对，占位符语法错误');
    const phRe = /\{([^{}]*)\}/g;
    let m;
    while ((m = phRe.exec(body)) !== null) {
      const ph = m[1].trim();
      if (!ph) issues.push("发现空占位符 '{}'");
      else if (!/^[A-Za-z0-9_]+$/.test(ph)) issues.push('占位符非法: ' + m[0]);
    }
    const nPh = (body.match(/\{[^{}]*\}/g) || []).length;
    if (nPh < 1) issues.push('模板缺少占位符，无法作为可复用模板');
    if (nPh > 20) issues.push('占位符过多(' + nPh + ' 个)，建议精简');

    const passed = issues.length === 0 && score >= 60;
    return { score: passed ? round1(score) : round1(score * 0.5), passed, issues };
  }

  /** 每日生长：用全新种子批量生成 + 质检，返回逐日统计与今日新模板 */
  simulateGrowth(days, batchSize, baseSeed, platforms) {
    days = days || 1;
    batchSize = batchSize || 20;
    baseSeed = baseSeed || 20260829;
    platforms = platforms || Object.keys(this.platform_rules);
    const todayTemplates = [];
    const daily = [];
    let total = 0, passed = 0;
    for (let day = 1; day <= days; day++) {
      let dTotal = 0, dPass = 0;
      for (let i = 0; i < batchSize; i++) {
        const seed = baseSeed * 10000 + day * 1000 + i;
        const platform = platforms[(day + i) % platforms.length];
        const tpl = this.generateTemplate(seed, platform);
        dTotal++; total++;
        if (tpl.passed) {
          dPass++; passed++;
          if (day === days) todayTemplates.push(tpl);
        }
      }
      daily.push({ day, total: dTotal, passed: dPass, rate: round1(dTotal ? (dPass / dTotal) * 100 : 0) });
    }
    return {
      daily,
      summary: { days, total, passed, rate: round1(total ? (passed / total) * 100 : 0) },
      todayTemplates
    };
  }

  /** 引擎静态统计 */
  stats() {
    const methods = [], seen = new Set();
    const byRole = { opening: 0, body: 0, closing: 0 };
    const byPlatform = {};
    for (const p of Object.keys(this.platform_rules)) byPlatform[p] = 0;
    for (const b of this.seed_bank) {
      if (!seen.has(b.method)) { seen.add(b.method); methods.push(b.method); }
      byRole[b.role]++;
      for (const p of b.platforms) if (p in byPlatform) byPlatform[p]++;
    }
    return { seedBankSize: this.seed_bank.length, methods, byRole, byPlatform };
  }
}

/* ======================================================================
 * 五、占位符工具 + 导出格式
 * ====================================================================== */
function extractPlaceholders(text) {
  const set = [];
  const re = /\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const ph = m[1].trim();
    if (ph && set.indexOf(ph) < 0) set.push(ph);
  }
  return set;
}

/** 把 {占位符} 替换为填入值 */
function fillTemplate(text, values) {
  return text.replace(/\{([^{}]*)\}/g, (_, ph) => {
    const v = values[ph];
    return (v !== undefined && v !== null && String(v).trim() !== '') ? String(v).trim() : '{' + ph + '}';
  });
}

/** 导出为纯文本：每个模板 = 标题 + 平台 + 结构 + 正文 + 评分 */
function exportToText(templates) {
  const lines = [];
  templates.forEach((t, i) => {
    lines.push('========== 模板 ' + (i + 1) + ' ==========');
    lines.push('【标题】' + t.title);
    lines.push('【平台】' + t.platformName + '　【评分】' + t.score + ' 分　【开场钩子】' + t.firstHookLevel + ' 级（' + t.firstHookName + '）');
    lines.push('【结构】' + t.structure.map((s) => s.method + '(' + s.name + ')').join(' → '));
    lines.push('【正文】');
    lines.push(t.body);
    lines.push('');
  });
  return lines.join('\n');
}

/** 导出为 Markdown */
function exportToMarkdown(templates) {
  const md = ['# ShotScript 无限模板导出\n'];
  templates.forEach((t, i) => {
    md.push('## ' + i + 1 + '. ' + t.title);
    md.push('');
    md.push('- **平台**：' + t.platformName);
    md.push('- **评分**：' + t.score + ' 分（' + (t.passed ? '通过质检' : '未通过') + '）');
    md.push('- **黄金3秒钩子**：' + t.firstHookLevel + ' 级 · ' + t.firstHookName);
    md.push('- **结构**：' + t.structure.map((s) => s.method + '(' + s.name + ')').join(' → '));
    md.push('');
    md.push('### 模板正文');
    md.push('');
    md.push(t.body.split('\n').map((line) => line.replace(/^/gm, '> ')).join('\n'));
    md.push('');
    md.push('---');
    md.push('');
  });
  return md.join('\n');
}

/** 简易字幕时间码（srt）：按句分配，约 4 字/秒 */
function formatSrtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds * 1000) % 1000);
  const p = (n, l) => String(n).padStart(l, '0');
  return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + ',' + p(ms, 3);
}

/** 导出为 srt 字幕：把正文按句拆分，逐句分配时间码 */
function exportToSrt(templates) {
  const lines = [];
  let idx = 1;
  let cursor = 0;
  templates.forEach((t) => {
    const sentences = t.body
      .split(/\n+|[。！？；!?;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    sentences.forEach((sent) => {
      const dur = Math.max(2, Math.round(sent.length / 4));
      const start = cursor;
      const end = cursor + dur;
      lines.push(String(idx));
      lines.push(formatSrtTime(start) + ' --> ' + formatSrtTime(end));
      lines.push(sent);
      lines.push('');
      idx++;
      cursor = end + 0.5;
    });
  });
  return lines.join('\n');
}

/** 根据导出格式生成文件名后缀 */
function exportFileName(base, format) {
  const ext = format === 'markdown' ? 'md' : format;
  return base + '.' + ext;
}

function round1(n) { return Math.round(n * 10) / 10; }

/* ---------------- 全局单例 ---------------- */
window.__SHOTSCRIPT_SEED_ENGINE = new SeedEngine();
