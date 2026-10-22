# 模型提供方与接口地址（2026-10-22 核实）

| 提供方 | 地址 | 依据 |
|---|---|---|
| 百炼 OpenAI 兼容 | https://dashscope.aliyuncs.com/compatible-mode/v1（或 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1） | https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope |
| 百炼 万相文生图（异步） | POST /api/v1/services/aigc/text2image/image-synthesis，头 X-DashScope-Async: enable | https://help.aliyun.com/zh/model-studio/first-call-to-image-and-video-api |
| 百炼 万相视频（异步） | POST /api/v1/services/aigc/video-generation/video-synthesis | https://www.alibabacloud.com/help/zh/doc-detail/2867393.html |
| 百炼 CosyVoice 语音合成（WebSocket） | wss://dashscope.aliyuncs.com/api-ws/v1/inference（或 wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference，由原生地址自动推导）；头 Authorization: Bearer；run-task → task-started → continue-task × N → finish-task → 二进制音频帧 → task-finished / task-failed；默认 cosyvoice-v3-flash，音色 longanyang（可在路由 voice 或提供方 ttsVoice 中改） | https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api |
| 百炼 千问图像编辑（同步） | POST /api/v1/services/aigc/multimodal-generation/generation，input.messages[0].content = 1-3 个 {image} + 1 个 {text}；默认 qwen-image-2.0-pro；返回 output.choices[].message.content[].image（24 小时有效链接） | https://help.aliyun.com/zh/model-studio/qwen-image-edit-api |
| OpenAI 图像编辑 | POST /v1/images/edits（multipart：model、prompt、image / image[]），默认 gpt-image-1 | OpenAI 官方文档 |
| 抖音开放平台 实时热点词 | GET https://open.douyin.com/hotsearch/sentences/，头 access-token = client_token（POST https://open.douyin.com/oauth/client_token/，client_key + client_secret + grant_type=client_credential，2 小时有效）；需申请 hotsearch 权限 | https://open.douyin.com/platform/resource/docs/openapi/data-open-service/hot-video-data/get-current-hot-words |
| 百炼 Paraformer 录音转写 | POST /api/v1/services/audio/asr/transcription | https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api |
| 小米 MiMo | OpenAI 兼容 https://api.xiaomimimo.com/v1（/chat/completions、GET /models）；Anthropic 兼容 https://api.xiaomimimo.com/anthropic（本项目未用）；Token Plan https://token-plan-cn.xiaomimimo.com/v1 | https://mimo.mi.com（2026-10-22 核实） |
| DeepSeek | https://api.deepseek.com | https://api-docs.deepseek.com/zh-cn/ |
| 智谱 | https://open.bigmodel.cn/api/paas/v4（videos/generations、async-result/{id}） | https://docs.bigmodel.cn/api-reference/ |
| 火山方舟 | https://ark.cn-beijing.volces.com/api/v3 | https://ark.volcengine.com/region:cn-beijing/docs/base-url-and-authentication |
| MiniMax | https://api.minimaxi.com/v1/t2a_v2、/v1/video_generation、/v1/query/video_generation | https://platform.minimaxi.com/docs/api-reference/speech-t2a-http |
| Kimi | https://api.moonshot.cn/v1 | https://platform.kimi.com/docs/api/overview |
| OpenAI | https://api.openai.com/v1 | OpenAI 官方文档 |
| Anthropic | https://api.anthropic.com/v1/messages（x-api-key、anthropic-version: 2023-06-01） | https://platform.claude.com/docs/en/api/messages |
| Gemini | https://generativelanguage.googleapis.com/v1beta/openai/ | https://ai.google.dev/gemini-api/docs/openai |
| ElevenLabs | https://api.elevenlabs.io/v1/text-to-speech/{voice_id}（xi-api-key） | https://elevenlabs.io/docs/api-reference/text-to-speech/convert |
| Ollama | http://localhost:11434/v1 | https://docs.ollama.com/api/openai-compatibility |
| ComfyUI | http://127.0.0.1:8188（POST /prompt、GET /history/{id}、GET /view） | https://docs.comfy.org/development/comfyui-server/comms_routes |

## 适配器实现情况
| 能力 | 已实现的协议 | 未实现（如实说明） |
|---|---|---|
| llm | openai（含 MiMo 方言）、anthropic、百炼兼容、智谱、MiniMax(OpenAI 风格) | — |
| vision / ocr | openai、anthropic、百炼兼容、智谱、方舟、Kimi、Gemini、Ollama | — |
| image | 生成：openai、百炼万相、智谱 CogView、方舟、ComfyUI；编辑（统一 `hub.imageEdit`，按输出张数计费，路由 tasks.edit / editModel 可单独指定）：百炼千问图像编辑、OpenAI images/edits、Mock | 智谱、方舟、ComfyUI 的图像编辑未接（选择后显示“未配置/未实现”）；万相 wanx2.1-imageedit（异步、按 function 区分）未接 |
| tts | openai、智谱、MiniMax、ElevenLabs、百炼 CosyVoice（官方 WebSocket，undici 客户端） | — |
| asr | openai、智谱、百炼 Paraformer（需公网音频链接） | 本地上传给 Paraformer 需先转存为公网链接 |
| video | 生成：百炼万相、智谱 CogVideoX、MiniMax 海螺（返回 file_id，需再调文件检索）；本地合成：`modules/video.ts` 用 ffmpeg 把配音 + SRT + 配图合成 1080x1920 MP4（Ken Burns 轮播，有中文字体则烧录字幕，否则软字幕） | — |
| embedding / rerank | openai 风格 /embeddings 与 /rerank | — |

除 mock 外，所有真实提供方仅通过假 HTTP 单元测试验证了请求/响应格式；因沙盒内没有各家密钥，**未做真实联调**（0.4.1 起小米 MiMo 对话/思考/缓存/JSON 已实跑，见上文）。0.2.0 新增的 CosyVoice、图像编辑、抖音开放平台热点词按官方文档实现，仅做了本地替身冒烟，同样**未做真实联调**。

## 小米 MiMo 接入（0.4.1）
**配置**
1. 模型 → 密钥：填“小米 MiMo API Key”（`model.mimo.key`）。服务器部署也可只设环境变量 `MIMO_API_KEY`（密钥库没有时读取）。
2. 模型 → 路由：文本/对话、视觉理解选“小米 MiMo”。默认模型 `mimo-v2.6-flash`；模型名输入框可下拉选 `mimo-v2.6-pro`、`mimo-v2.6-pro-ultraspeed`。可按任务分路由（如 `tasks.rewrite` 用 pro、`tasks.draft` 用 flash）。
3. “小米 MiMo 接入地址”：按量付费（`sk-` Key，https://api.xiaomimimo.com/v1）或 Token Plan（`tp-`/`ttp-` Key，https://token-plan-cn.xiaomimimo.com/v1）。
4. 思考模式（模型表“思考”列）：自动＝按模型名推断，MiMo 视为关；开＝下发 `thinking:{type:"enabled"}`。
- 已下线：mimo-v2.5-pro / mimo-v2.5（2026-10-21 10:00 北京时间），不要再用。

**适配差异（`chatDialect`，只影响 MiMo）**
| 项 | 处理 |
|---|---|
| 输出上限 | 传 `max_completion_tokens`（不传 `max_tokens`），上限 131072；默认非思考 8192 / 思考 65536 |
| 思考 | 总是显式下发 `thinking:{type:enabled|disabled}`（服务商默认 enabled）；视觉理解固定 disabled；思考时服务商强制 temperature 1.0 / top_p 0.95，所以不下发 temperature |
| 评测 | `deterministicChat` 强制 thinking disabled + temperature 0（MiMo 不支持 seed，不传） |
| temperature | 截断到 [0, 1.5] |
| response_format | 只支持 text / json_object：`json_schema` 降级为 `json_object`，本地 Schema 校验 + 一次修复 |
| tool_choice | 只支持 auto（本项目未用工具调用） |
| 返回 | `message.reasoning_content` → `reasoning`；`usage.prompt_tokens_details.cached_tokens` → 缓存命中；`completion_tokens_details.reasoning_tokens` → `reasoningOutput`；两个 details 可能为 null（已容错） |
| finish_reason | `repetition_truncation`（复读被截断）自动重试一次；仍截断则结果带 `warnings` 并写 warn 日志 |
| 认证 | `Authorization: Bearer`（官方也接受 `api-key` 头） |

**内置默认价（国内，元/百万 token，缓存命中 / 未命中 / 输出）**：v2.6-flash 0.02 / 1.00 / 2.00；v2.6-pro 0.025 / 3.00 / 6.00；v2.6-pro-ultraspeed 0.25 / 30 / 60。设置里填同名键（如 `mimo:mimo-v2.6-pro`）覆盖。TTS mimo-v2.5-tts（限时免费）与 ASR mimo-v2.5-asr（¥0.5/小时）**尚未接入**。

**真实联调冒烟**（会产生几分钱费用）
```bash
MIMO_API_KEY=sk-xxx npm run mimo:smoke
MIMO_API_KEY=tp-xxx MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1 npm run mimo:smoke
MIMO_INJECTED=1 npm run mimo:smoke     # 网络层注入密钥时
```
依次：a) GET /models；b) flash 非思考短对话；c) flash 思考（reasoning 分离）；d) 同一稳定前缀连续 2 次看 `cached_tokens`；e) json_object + 本地 Schema 生成小红书笔记（标题 ≤20、正文 ≤1000）；f) pro 一次成稿对比。默认每项只调用一次（d 两次），不做修复/截断重试（`MIMO_SMOKE_REPAIR=1` 打开）。报告写到 stdout 与 `out/mimo-smoke-report.json`，不含密钥。缺 Key 时退出码 2、不发请求；有失败项退出码 1。

2026-10-22 首次实跑（按量 base）：6/6 通过，合计约 ¥0.013。flash 非思考 2.7s；思考 4.4s（reasoning 98 token，正文无 `<think>`）；稳定前缀第 2 次命中 2304/2338 token（98.5%）；小红书 flash 8.5s 一次通过（标题 11 字 / 正文 249 字），pro 14.4s 一次通过（15 / 335），pro 单篇成本约 flash 的 12 倍。

## 抖音热榜说明（2026-10-22 核实）
- `https://www.douyin.com/robots.txt` 只对列出的搜索引擎/AI 爬虫 UA 设了规则，没有 `User-agent: *` 组，因此通用 UA 访问 `/aweme/v1/web/hot/search/list/` 不被 robots 禁止。
- 但该接口对不带签名参数（a_bogus 等）与登录 Cookie 的普通请求返回 HTTP 200 + 空内容。本项目不伪造签名、不伪装浏览器，因此该榜单如实标注为 `needs_official_api`。
- 替代方案：抖音开放平台“获取实时热点词”（上表）。在密钥库填写 `douyin.client_key` + `douyin.client_secret`（或直接填 `douyin.client_token`）即可启用；未填写时显示“未配置”。
