/**
 * 热点来源表（0.8.0，修订 R1：五路并行）。界面“来源说明”与 hot_fetch 都读这里。
 * 路数：a 第三方数据服务连接器（用户自己的 API Key）｜b 平台官方接口 / 官方页面｜c 分享进来（系统分享 / 选中文字）｜
 *       d 搜索与新闻自动收集（公开 RSS、公开榜单，先查 robots）｜e 热点巡视（内置浏览器依次打开，用户本人翻看，Agent 不读页面）。
 * robots 与 API 是否存在于 2026-10-22 复核，见 design/refs-v8/README.md 第八节。
 */
export type Route = 'a' | 'b' | 'c' | 'd' | 'e';
export const ROUTE_LABEL: Record<Route, string> = { a: '数据服务', b: '官方接口', c: '分享进来', d: '公开新闻', e: '热点巡视' };

/** d 路：公开 RSS 与公开榜单（本机直接读，先查 robots）。 */
export interface PublicSource { id: string; label: string; kind: 'rss' | 'board'; url: string; platform: string; defaultOn: boolean; note?: string }
export const PUBLIC_SOURCES: PublicSource[] = [
  { id: 'baidu', label: '百度热搜', kind: 'board', url: 'https://top.baidu.com/api/board?platform=wise&tab=realtime', platform: '综合', defaultOn: true, note: 'robots 404 = 未禁止' },
  { id: 'sspai', label: '少数派', kind: 'rss', url: 'https://sspai.com/feed', platform: '科技', defaultOn: true },
  { id: 'solidot', label: 'Solidot', kind: 'rss', url: 'https://www.solidot.org/index.rss', platform: '科技', defaultOn: true },
  { id: '36kr', label: '36氪', kind: 'rss', url: 'https://36kr.com/feed', platform: '商业', defaultOn: true, note: '官方 RSS' },
  { id: 'ithome', label: 'IT之家', kind: 'rss', url: 'https://www.ithome.com/rss/', platform: '科技', defaultOn: false, note: 'robots 允许 /rss/' },
  { id: 'gtrends', label: 'Google Trends（官方 RSS）', kind: 'rss', url: 'https://trends.google.com/trending/rss?geo=CN', platform: '海外', defaultOn: false, note: '国内网络可能读不到' },
];

/** a 路：第三方数据服务连接器的说明（实现见 web/src/hot/connectors.ts）。status：supported 已支持｜partial 部分支持｜unsupported 暂不支持（没有公开 API，不编造接口）。 */
export interface ConnectorMeta { id: string; label: string; status: 'supported' | 'partial' | 'unsupported'; covers: string; apply: string; docs?: string; fields: { key: string; label: string; secret: boolean; placeholder?: string; optional?: boolean }[]; note: string }
export const CONNECTORS: ConnectorMeta[] = [
  {
    id: 'tophub', label: '今日热榜（榜眼数据）', status: 'supported', covers: '微博、知乎、抖音、B站、百度、头条等上万个榜单的标题与链接',
    apply: 'https://www.tophubdata.com/register', docs: 'https://www.tophubdata.com/documentation',
    fields: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: '控制台里的 Key' }],
    note: '官方付费 API（Authorization 请求头）。拉取“榜中榜”当天 TOP100；数据只含上榜标题与链接。',
  },
  {
    id: 'newrank', label: '新榜', status: 'partial', covers: '公众号、抖音等新媒体榜单与热门文章',
    apply: 'https://api.newrank.cn/', docs: 'https://api.newrank.cn/',
    fields: [
      { key: 'apiKey', label: 'API Key', secret: true, placeholder: '数据 API 控制台里的 Key' },
      { key: 'path', label: '榜单接口路径（按你的控制台文档填）', secret: false, placeholder: '/api/sync/…', optional: true },
      { key: 'params', label: '接口参数（a=1&b=2）', secret: false, optional: true },
    ],
    note: '官方付费 API（Key 请求头，POST 表单）。具体榜单接口路径以你购买的套餐文档为准，本软件不预设路径；不填时只能测试连接。',
  },
  {
    id: 'qiangua', label: '千瓜数据（小红书）', status: 'unsupported', covers: '小红书热门笔记、话题、达人',
    apply: 'https://www.qian-gua.com/', fields: [],
    note: '没有找到公开的开发者 API（2026-10-22 核实），暂不支持接入；可在内置浏览器打开官网自己看。',
  },
  {
    id: 'xinhong', label: '新红（新榜旗下，小红书）', status: 'unsupported', covers: '小红书账号与笔记榜单',
    apply: 'https://xh.newrank.cn/', fields: [],
    note: '没有找到公开的开发者 API（2026-10-22 核实），暂不支持接入；可在内置浏览器打开自己看。',
  },
];

/** b 路：平台官方接口（用户自己的开放平台凭证）与官方页面（只打开给用户看）。 */
export const DOUYIN_OPEN = {
  id: 'douyin_open', label: '抖音开放平台 · 实时热点词', apply: 'https://developer.open-douyin.com/',
  docs: 'https://open.douyin.com/platform/resource/docs/openapi/data-open-service/hot-video-data/get-current-hot-words',
  fields: [{ key: 'clientKey', label: 'client_key', secret: true }, { key: 'clientSecret', label: 'client_secret', secret: true }],
  note: '需要你在抖音开放平台创建应用并申请 hotsearch 权限。热点榜约两小时刷新一次。',
};
export const OFFICIAL_PAGES = [
  { id: 'trendinsight', label: '巨量算数', url: 'https://trendinsight.oceanengine.com/', hosts: ['trendinsight.oceanengine.com', 'oceanengine.com'] },
];

/** e 路：热点巡视队列（官方热榜 / 发现页）。在内置浏览器依次打开给用户本人看，Agent 不读取页面。 */
export interface PatrolStop { id: string; platform: string; label: string; url: string; hosts: string[] }
export const PATROL_STOPS: PatrolStop[] = [
  { id: 'weibo', platform: 'weibo', label: '微博热搜', url: 'https://s.weibo.com/top/summary', hosts: ['weibo.com', 's.weibo.com', 'm.weibo.cn', 'passport.weibo.com'] },
  { id: 'xiaohongshu', platform: 'xiaohongshu', label: '小红书发现', url: 'https://www.xiaohongshu.com/explore', hosts: ['xiaohongshu.com', 'www.xiaohongshu.com'] },
  { id: 'douyin', platform: 'douyin', label: '抖音热榜', url: 'https://www.douyin.com/hot', hosts: ['douyin.com', 'www.douyin.com'] },
  { id: 'zhihu', platform: 'zhihu', label: '知乎热榜', url: 'https://www.zhihu.com/hot', hosts: ['zhihu.com', 'www.zhihu.com'] },
  { id: 'bilibili', platform: 'bilibili', label: 'B站热门', url: 'https://www.bilibili.com/v/popular/all', hosts: ['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'] },
  { id: 'kuaishou', platform: 'kuaishou', label: '快手', url: 'https://www.kuaishou.com/', hosts: ['kuaishou.com', 'www.kuaishou.com'] },
  { id: 'trendinsight', platform: 'douyin', label: '巨量算数', url: 'https://trendinsight.oceanengine.com/', hosts: ['trendinsight.oceanengine.com', 'oceanengine.com'] },
  { id: 'baidu', platform: '综合', label: '百度热搜', url: 'https://top.baidu.com/board', hosts: ['top.baidu.com', 'baidu.com'] },
];

/** 逐平台说明（界面“来源说明”）。 */
export interface PlatformSourceRow { platform: string; label: string; routes: Route[]; how: string; status: string }
export const PLATFORM_SOURCES: PlatformSourceRow[] = [
  { platform: '综合', label: '综合', routes: ['d', 'a'], how: '百度热搜公开榜单（robots 未禁止）；今日热榜 API（你的 Key）', status: '可用' },
  { platform: '科技', label: '科技 / 商业', routes: ['d'], how: '少数派、Solidot、36氪、IT之家官方 RSS', status: '可用' },
  { platform: 'douyin', label: '抖音', routes: ['b', 'a', 'c', 'e'], how: '抖音开放平台实时热点词（你的 client_key / client_secret）；今日热榜 API；分享进来；巡视抖音热榜与巨量算数', status: '填凭证后可用，否则“需官方接口”' },
  { platform: 'weibo', label: '微博', routes: ['a', 'c', 'e'], how: '今日热榜 API（含微博热搜）；网页 robots 对通用程序 Disallow: /，本软件不读', status: '需数据服务或发给 Agent' },
  { platform: 'zhihu', label: '知乎', routes: ['a', 'c', 'e'], how: '今日热榜 API；网页 robots 对通用程序 Disallow: /', status: '需数据服务或发给 Agent' },
  { platform: 'bilibili', label: 'B站', routes: ['a', 'c', 'e'], how: '今日热榜 API；api.bilibili.com robots 全站禁止', status: '需数据服务或发给 Agent' },
  { platform: 'xiaohongshu', label: '小红书', routes: ['c', 'e'], how: '没有可合法读取的公开热榜（robots Disallow: /），千瓜 / 新红无公开 API；分享进来或巡视时选中文字发给 Agent', status: '发给 Agent' },
  { platform: 'kuaishou', label: '快手', routes: ['c', 'e'], how: '无公开热榜接口（robots Disallow: /）', status: '发给 Agent' },
  { platform: 'wechat', label: '公众号 / 视频号', routes: ['a', 'c'], how: '新榜 API（你的 Key 与接口路径）；分享进来', status: '需数据服务或发给 Agent' },
  { platform: 'x', label: 'X', routes: ['c'], how: 'X API v2 trends 需付费 Bearer（本机模式未接）；分享进来', status: '需官方接口' },
];

/** 平台显示名（热点结果卡里的灰色说明行）。 */
export const NO_PUBLIC_SOURCE_HINT: Record<string, string> = {
  xiaohongshu: '小红书：没有可合法读取的公开热榜。你可以在侧栏打开小红书或点“热点巡视”，看到热点后选中文字点“发给 Agent”，我会一起分析。',
  kuaishou: '快手：没有公开热榜接口。可以分享到超级工作台，或在巡视时发给我。',
  weibo: '微博：网页不允许程序读取。连接“今日热榜”数据服务后可自动汇总，或巡视时发给我。',
  zhihu: '知乎：网页不允许程序读取。连接“今日热榜”后可自动汇总，或巡视时发给我。',
};
