# 模型提供方与接口地址（2026-10-22 核实）

| 提供方 | 地址 | 依据 |
|---|---|---|
| 百炼 OpenAI 兼容 | https://dashscope.aliyuncs.com/compatible-mode/v1（或 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1） | https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope |
| 百炼 万相文生图（异步） | POST /api/v1/services/aigc/text2image/image-synthesis，头 X-DashScope-Async: enable | https://help.aliyun.com/zh/model-studio/first-call-to-image-and-video-api |
| 百炼 万相视频（异步） | POST /api/v1/services/aigc/video-generation/video-synthesis | https://www.alibabacloud.com/help/zh/doc-detail/2867393.html |
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
| image | openai、百炼万相、智谱 CogView、方舟、ComfyUI | 图像编辑（inpainting）接口未接 |
| tts | openai、智谱、MiniMax、ElevenLabs | 百炼 CosyVoice（需 WebSocket/SDK）未接 |
| asr | openai、智谱、百炼 Paraformer（需公网音频链接） | 本地上传给 Paraformer 需先转存为公网链接 |
| video | 百炼万相、智谱 CogVideoX、MiniMax 海螺（返回 file_id，需再调文件检索） | 视频合成剪辑（配音+字幕烧录）未做 |
| embedding / rerank | openai 风格 /embeddings 与 /rerank | — |

除 mock 外，所有真实提供方仅通过假 HTTP 单元测试验证了请求/响应格式；因沙盒内没有各家密钥，**未做真实联调**。
