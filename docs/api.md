# 接口文档（REST）

- 基础地址：网页版同源；App 版为“设置 → 服务地址”。
- 认证：若设置了 `CA_ACCESS_TOKEN`，所有 `/api/*`（除 `/api/health`）需带请求头 `x-access-token`。
- 错误格式：`{"error": {"code", "message", "advice"}}`；未配置类错误返回 409、`code=not_configured`。
- 所有响应带 CSP、X-Frame-Options、nosniff、no-referrer 头。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（无需口令） |
| GET | `/api/boundaries` | 硬边界与工具白名单 |
| GET | `/api/settings` | 读取/保存代理、采集间隔、热点关键词等（密钥只返回掩码） |
| PUT | `/api/settings` | 读取/保存代理、采集间隔、热点关键词等（密钥只返回掩码） |
| PUT | `/api/secrets/:name` | 写入或清除一个密钥（加密落盘） |
| GET | `/api/models` | 模型能力、提供方、路由、单价与状态 |
| PUT | `/api/models/routes` | 保存各能力的路由（默认/备用/任务级） |
| PUT | `/api/models/providers/:id` | 覆盖提供方的基础地址、代理、默认模型 |
| PUT | `/api/models/prices` | 保存单价（用于成本统计） |
| PUT | `/api/models/comfyui-workflow` | 保存 ComfyUI 工作流 JSON（含 {{prompt}}） |
| GET | `/api/models/costs` | 成本统计：按日、按能力、按提供方 |
| POST | `/api/models/test/:cap` | 连通性测试（llm/embedding/image/tts） |
| GET | `/api/sources` | 信息源列表与适配器 / 新增信息源 |
| POST | `/api/sources` | 信息源列表与适配器 / 新增信息源 |
| DELETE | `/api/sources/:id` | 删除信息源 |
| POST | `/api/sources/:id/run` | 立即采集一次（经任务队列） |
| GET | `/api/items` | 内容库查询（search/tag/sourceId/limit/offset） |
| POST | `/api/items/semantic-search` | 语义检索（重排序模型） |
| GET | `/api/topics` | 选题列表 |
| POST | `/api/topics/generate` | 由内容库条目生成选题 |
| POST | `/api/topics/:id/dismiss` | 跳过选题 |
| GET | `/api/platforms` | 本终端可用的改写平台及缺失能力 |
| POST | `/api/rewrite` | 多平台改写流水线（文本→配图/配音/字幕） |
| GET | `/api/drafts` | 草稿列表（按状态） |
| GET | `/api/drafts/:id` | 草稿详情与修改记录 / 编辑草稿（留痕） |
| PUT | `/api/drafts/:id` | 草稿详情与修改记录 / 编辑草稿（留痕） |
| POST | `/api/drafts/:id/status` | 审核状态流转 |
| GET | `/api/drafts/:id/handoff` | 发布交接卡 |
| POST | `/api/drafts/:id/handoff/copy` | 记录复制交接（需已通过） |
| POST | `/api/drafts/:id/handoff/wechat-draft` | 推送公众号草稿箱（不发布） |
| GET | `/api/creator-centers` | 官方创作中心列表 |
| POST | `/api/replies/draft` | 评论/私信回复草稿（不发送） |
| GET | `/api/hot` | 热榜最新状态、跨榜合并、关键词命中 |
| POST | `/api/hot/fetch` | 采集热榜（robots 检查、限速、缓存） |
| POST | `/api/hot/cluster` | 热点语义聚类 |
| POST | `/api/hot/research` | 话题簇深度调研 → 选题卡 |
| POST | `/api/analytics/import` | 导入 CSV |
| GET | `/api/analytics/summary` | 数据汇总 |
| POST | `/api/analytics/review` | 模型复盘（注明样本量） |
| GET | `/api/agent/files` | 系统文件、记忆列表、需确认动作 |
| GET | `/api/agent/file` | 读取 / 保存系统文件（生成版本） |
| PUT | `/api/agent/file` | 读取 / 保存系统文件（生成版本） |
| GET | `/api/agent/memory` | 读取记忆文件（只读） |
| GET | `/api/versions` | 全部版本记录 |
| GET | `/api/versions/:id` | 版本详情 |
| POST | `/api/versions/:id/rollback` | 回滚到该版本 |
| GET | `/api/improvement-log` | 改进日志 |
| GET | `/api/skills` | skills 列表、需要的模型能力、加载错误 |
| GET | `/api/evals/benchmark` | 评测基准集 |
| POST | `/api/evals/ab` | A/B 评测两个 skill 版本 |
| GET | `/api/plugins` | 按终端读取 / 保存启用的插件 |
| PUT | `/api/plugins` | 按终端读取 / 保存启用的插件 |
| GET | `/api/tasks` | 任务面板 |
| GET | `/api/logs` | 结构化日志（脱敏） |
| GET | `/api/notifications` | 待审草稿数、热点命中 |
| GET | `/api/backup/export` | 导出备份（不含密钥） |
| POST | `/api/backup/import` | 导入备份（先自动备份） |
| GET | `/api/media/:draft/:name` | 生成的配图、配音、字幕文件 |

## 示例
```bash
# 选择 DeepSeek 作为文本模型
curl -X PUT localhost:8787/api/secrets/model.deepseek.key -H "content-type: application/json" -d '{"value":"sk-..."}'
curl -X PUT localhost:8787/api/models/routes -H "content-type: application/json" -d '{"routes":{"llm":{"default":{"provider":"deepseek","model":"deepseek-v4-pro"}}}}'
# 改写到小红书与抖音
curl -X POST localhost:8787/api/rewrite -H "content-type: application/json" -d '{"topicId":1,"platforms":["xiaohongshu","douyin_script"]}'
```
