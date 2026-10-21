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
| llm | openai、anthropic、百炼兼容、智谱、MiniMax(OpenAI 风格) | — |
| vision / ocr | openai、anthropic、百炼兼容、智谱、方舟、Kimi、Gemini、Ollama | — |
| image | 生成：openai、百炼万相、智谱 CogView、方舟、ComfyUI；编辑（统一 `hub.imageEdit`，按输出张数计费，路由 tasks.edit / editModel 可单独指定）：百炼千问图像编辑、OpenAI images/edits、Mock | 智谱、方舟、ComfyUI 的图像编辑未接（选择后显示“未配置/未实现”）；万相 wanx2.1-imageedit（异步、按 function 区分）未接 |
| tts | openai、智谱、MiniMax、ElevenLabs、百炼 CosyVoice（官方 WebSocket，undici 客户端） | — |
| asr | openai、智谱、百炼 Paraformer（需公网音频链接） | 本地上传给 Paraformer 需先转存为公网链接 |
| video | 生成：百炼万相、智谱 CogVideoX、MiniMax 海螺（返回 file_id，需再调文件检索）；本地合成：`modules/video.ts` 用 ffmpeg 把配音 + SRT + 配图合成 1080x1920 MP4（Ken Burns 轮播，有中文字体则烧录字幕，否则软字幕） | — |
| embedding / rerank | openai 风格 /embeddings 与 /rerank | — |

除 mock 外，所有真实提供方仅通过假 HTTP 单元测试验证了请求/响应格式；因沙盒内没有各家密钥，**未做真实联调**。0.2.0 新增的 CosyVoice、图像编辑、抖音开放平台热点词按官方文档实现，仅做了本地替身冒烟，同样**未做真实联调**。

## 抖音热榜说明（2026-10-22 核实）
- `https://www.douyin.com/robots.txt` 只对列出的搜索引擎/AI 爬虫 UA 设了规则，没有 `User-agent: *` 组，因此通用 UA 访问 `/aweme/v1/web/hot/search/list/` 不被 robots 禁止。
- 但该接口对不带签名参数（a_bogus 等）与登录 Cookie 的普通请求返回 HTTP 200 + 空内容。本项目不伪造签名、不伪装浏览器，因此该榜单如实标注为 `needs_official_api`。
- 替代方案：抖音开放平台“获取实时热点词”（上表）。在密钥库填写 `douyin.client_key` + `douyin.client_secret`（或直接填 `douyin.client_token`）即可启用；未填写时显示“未配置”。
