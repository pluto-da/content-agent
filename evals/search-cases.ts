/**
 * 0.11.0 检索评测样例（ROADMAP 0.11「向量检索转正：检索前 5 命中率在 30 条样例上 ≥ 0.8」）。
 * 语料 = 一个单人账号常见的记忆 / 草稿 / 素材（36 条）；30 条查询分三类，各 10 条：
 *   exact  —— 查询与目标文档有相同关键词；
 *   para   —— 换说法 / 近义词（目标文档里几乎没有查询原词）；
 *   fuzzy  —— 口语化、错字、中英混写、只记得一半。
 * 每条查询只认 1 个正确文档（expect），前 5 命中即算对。样例在写检索代码之前定稿，没有按结果回改。
 */
import type { Doc } from '../shared/src/index.js';

export const SEARCH_CORPUS: Doc[] = [
  { path: 'memory/preferences.md#audience', text: '目标受众：宝妈，孩子 0–3 岁，关心辅食和睡眠。' },
  { path: 'memory/preferences.md#tone', text: '写作口吻：像朋友聊天，别用感叹号，少用网络流行语。' },
  { path: 'memory/preferences.md#platform', text: '以后的内容默认都发小红书，抖音只做口播。' },
  { path: 'memory/preferences.md#time', text: '发布时段：工作日晚上 8 点到 9 点数据最好，周末中午次之。' },
  { path: 'memory/preferences.md#redline', text: '红线：不推减肥药、不写医疗功效、不碰保健品。' },
  { path: 'memory/preferences.md#cover', text: '首图偏好：白底、大字标题、不放人脸。' },
  { path: 'memory/lessons.md#l1', text: '经验：标题前 10 个字出现数字的笔记，收藏率高一些（样本 6 篇，待验证）。' },
  { path: 'memory/lessons.md#l2', text: '经验：带“教程”字样的笔记比纯分享多 30% 关注（样本 4 篇，低置信）。' },
  { path: 'memory/lessons.md#l3', text: '经验：评论区置顶一条问题能带动留言。' },
  { path: 'memory/daily/2026-10-20.md', text: '10 月 20 日复盘：馆陶小米那篇阅读 3000，其余在 100 左右，原因可能是赶上了秋收热点。' },
  { path: 'memory/daily/2026-10-21.md', text: '10 月 21 日：试了两张封面，白底的点击率更高。' },
  { path: 'memory/daily/2026-10-22.md', text: '10 月 22 日：抖音口播稿 200 字录了 58 秒，语速偏快。' },
  { path: 'draft:1', text: '小红书草稿《馆陶小米熬粥，米油厚到能立勺》：产地直发，熬出米油的三个诀窍。' },
  { path: 'draft:2', text: '小红书草稿《上班族秋季养生 3 个工位小习惯》：温水、拉伸、早睡。' },
  { path: 'draft:3', text: '抖音口播稿《通勤穿搭三个公式》：白衬衫配直筒裤，针织开衫配半裙。' },
  { path: 'draft:4', text: '小红书草稿《宝宝辅食第一口吃什么》：米粉、南瓜泥、蛋黄的顺序。' },
  { path: 'draft:5', text: '公众号推文《我们店的咖啡为什么卖 15 块》：豆子、烘焙和房租的账。' },
  { path: 'draft:6', text: '闲鱼商品文案：九成新婴儿推车，可坐可躺，同城自提。' },
  { path: 'draft:7', text: '小红书草稿《秋冬换季护肤，先停掉去角质》：保湿面霜怎么选。' },
  { path: 'draft:8', text: '视频号脚本《国庆假期第二杯半价》：门店活动介绍，30 秒。' },
  { path: 'asset:hot-1', text: '热点快照：百度热搜“秋收季 小米丰收”，10 月 19 日。' },
  { path: 'asset:hot-2', text: '热点快照：百度热搜“降温 秋季养生”，10 月 21 日。' },
  { path: 'asset:note-1', text: '素材：用户留言“米油是什么？要熬多久？”' },
  { path: 'asset:note-2', text: '素材：粉丝私信问推车能不能上飞机。' },
  { path: 'asset:csv-1', text: '导入数据：9 月 30 篇笔记平均阅读 180，平均点赞 12，平均收藏 9。' },
  { path: 'asset:csv-2', text: '导入数据：抖音 9 月播放中位数 600，完播率 18%。' },
  { path: 'asset:rule-1', text: '平台规则摘录：小红书标题上限 20 字，正文上限 1000 字。' },
  { path: 'asset:rule-2', text: '平台规则摘录：AI 生成的图片需要在发布时勾选“AI 生成”声明。' },
  { path: 'asset:rule-3', text: '违禁词清单：最、第一、国家级、根治、特效。' },
  { path: 'asset:revenue-1', text: '收入记录：10 月闲鱼卖出推车 1 台，收入 380 元。' },
  { path: 'asset:revenue-2', text: '收入记录：9 月小红书好物分享佣金 126 元。' },
  { path: 'asset:plan-1', text: '计划：11 月每周 3 篇小红书、2 条抖音，重点做辅食和睡眠。' },
  { path: 'asset:plan-2', text: '计划：试一次直播，先在视频号做 30 分钟答疑。' },
  { path: 'asset:model-1', text: '模型备注：生图用通义万相，配音用小米 MiMo，转写也用 MiMo。' },
  { path: 'asset:budget-1', text: '预算：每月模型费用不超过 30 元，单次超过 1 元先问我。' },
  { path: 'asset:contact-1', text: '合作意向：一家本地母婴店想要探店笔记，还没报价。' },
];

export interface SearchCase { q: string; expect: string; kind: 'exact' | 'para' | 'fuzzy' }
export const SEARCH_CASES: SearchCase[] = [
  // exact
  { q: '目标受众', expect: 'memory/preferences.md#audience', kind: 'exact' },
  { q: '感叹号', expect: 'memory/preferences.md#tone', kind: 'exact' },
  { q: '馆陶小米熬粥', expect: 'draft:1', kind: 'exact' },
  { q: '通勤穿搭', expect: 'draft:3', kind: 'exact' },
  { q: '违禁词清单', expect: 'asset:rule-3', kind: 'exact' },
  { q: '婴儿推车 闲鱼', expect: 'draft:6', kind: 'exact' },
  { q: '完播率', expect: 'asset:csv-2', kind: 'exact' },
  { q: '直播 视频号', expect: 'asset:plan-2', kind: 'exact' },
  { q: '模型费用 预算', expect: 'asset:budget-1', kind: 'exact' },
  { q: '评论区置顶', expect: 'memory/lessons.md#l3', kind: 'exact' },
  // para（换说法 / 近义词）
  { q: '我的粉丝画像是什么人', expect: 'memory/preferences.md#audience', kind: 'para' },
  { q: '几点发效果好', expect: 'memory/preferences.md#time', kind: 'para' },
  { q: '头图要什么风格', expect: 'memory/preferences.md#cover', kind: 'para' },
  { q: '什么写法能多吸粉', expect: 'memory/lessons.md#l2', kind: 'para' },
  { q: '哪篇流量特别高', expect: 'memory/daily/2026-10-20.md', kind: 'para' },
  { q: '念稿一分钟能读多少', expect: 'memory/daily/2026-10-22.md', kind: 'para' },
  { q: '咖啡定价的理由', expect: 'draft:5', kind: 'para' },
  { q: '国庆打折活动', expect: 'draft:8', kind: 'para' },
  { q: '哪些东西坚决不推', expect: 'memory/preferences.md#redline', kind: 'para' },
  { q: '靠二手赚了多少钱', expect: 'asset:revenue-1', kind: 'para' },
  // fuzzy（口语、错字、中英混写、半句）
  { q: 'xhs 标题最多几个字', expect: 'asset:rule-1', kind: 'fuzzy' },
  { q: '宝宝辅食先吃啥', expect: 'draft:4', kind: 'fuzzy' },
  { q: '换季护夫', expect: 'draft:7', kind: 'fuzzy' },
  { q: 'AI 图要不要声明', expect: 'asset:rule-2', kind: 'fuzzy' },
  { q: '米油熬多久那个留言', expect: 'asset:note-1', kind: 'fuzzy' },
  { q: '推车上飞机', expect: 'asset:note-2', kind: 'fuzzy' },
  { q: '打工人养生', expect: 'draft:2', kind: 'fuzzy' },
  { q: '配音用的哪家', expect: 'asset:model-1', kind: 'fuzzy' },
  { q: '母婴店探店报价', expect: 'asset:contact-1', kind: 'fuzzy' },
  { q: '九月笔记平均数据', expect: 'asset:csv-1', kind: 'fuzzy' },
];
