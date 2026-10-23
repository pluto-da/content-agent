# 1.1.0 服务商能力表（PROMPT-v1.1 §5.4）

> 核对日期：**2026-10-24**（Asia/Shanghai）。每一格只写当天打开的官方文档明示的能力；文档没写的留“—（文档未写）”，不臆测。
> 图例：✓ 文档明示支持　✗ 文档明示不支持　— 文档未写 / 本表不覆盖　“实测”= 本项目用真实 Key 跑过（见 evals/real/）。
> 没有 Key 的服务商一律“未实测”。能力列与 App 能力覆盖一览一致：对话 / 思考 / 看图 / 生图 / 改图 / 配音 / 转写 / 视频 / 向量。

## 总表

| 服务商 | 对话 | 思考 | 看图 | 生图 | 改图 | 配音 | 转写 | 视频 | 向量 | 实测 |
|---|---|---|---|---|---|---|---|---|---|---|
| 小米 MiMo | ✓ [1] | ✓ [2] | ✓ [2] | — | — | ✓ [1][3] | ✓ [1] | — | — | 对话 / 思考 / 看图 / 配音 实测（D15，evals/real/mimo-v1.1.json） |
| 阿里百炼 / 千问 | ✓ [4] | ✓ [5] | ✓ [4] | ✓ [4] | ✓ [4] | ✓ [4] | ✓ [4] | ✓ [4] | ✓ [4] | 未实测 |
| 智谱 GLM | ✓ [6] | ✓ [7] | ✓ [6] | ✓ [6] | — | ✓ [6] | ✓ [6] | ✓ [6] | ✓ [6] | 未实测 |
| 火山方舟 / 豆包 | ✓ [8] | ✓ [8] | ✓ [8] | ✓ [8] | ✓ [8]（单图 / 多参考图生图） | — | — | ✓ [8] | ✓ [8] | 未实测 |
| DeepSeek | ✓ [9] | ✓ [9] | deepseek-flash ✓ / v4-pro ✗ [9] | — | — | — | — | — | — | 未实测 |
| MiniMax | ✓ [10] | ✓（M3.1-Flash 思考深度可调）[10] | ✓（“原生多模态”）[10] | ✓ [10] | ✓（image-01 图生图）[10] | ✓ [10] | — | ✓ [10] | — | 未实测 |
| 月之暗面 Kimi | ✓ [11] | ✓ [12] | ✓ [11] | — | — | — | — | — | — | 未实测 |
| OpenAI 兼容（自定义） | ✓（协议本身） | 视具体模型 | 视具体模型 | 视具体模型 | 视具体模型 | 视具体模型 | 视具体模型 | — | 视具体模型 | 未实测；能力由名字规则 + 用户勾选（deviations V11-08） |

## 逐家说明（模型名 = 文档当天列出的现行名）

### 1. 小米 MiMo（主机 api.xiaomimimo.com）
- 现行模型（/v1/models 文档示例）：`mimo-v2.6-pro`、`mimo-v2.6-flash`、`mimo-v2.6-pro-ultraspeed`、`mimo-v2.5-tts`（及 `-voiceclone`、`-voicedesign`）、`mimo-v2.5-asr`。MiMo-V2.5-Pro / V2.5 已于 2026-10-21 下线。[1]
- V2.6 Pro / Flash 为“原生全模态模型”，含多模态感知、3D 空间推理、CUA。[2]
- TTS：同一 chat/completions 端点，合成文本放 assistant 消息，返回 `choices[0].message.audio.data`（Base64）。[3]
- 对 App：一个 Key 覆盖 对话 + 思考 + 看图 + 配音 + 转写；生图 / 改图 / 视频需另接一家。

### 2. 阿里百炼 / 千问
- 文本：qwen3.8-max、qwen3.7-plus、qwen3.8-flash；理解：qwen3.8-max / qwen3.7-plus / qwen3.8-omni-flash；生成：qwen-image-3.0-pro、wan2.7-image-pro（图像，含编辑）、wan3.0-video、happyhorse-1.1-t2v/i2v/r2v；语音合成 qwen-audio-3.0-tts-plus；识别 qwen-audio-3.1-asr-flash-*；向量 qwen3.7-text-embedding(-flash)、qwen3-vl-embedding；重排 qwen3.7-text-rerank。[4]
- 思考：qwen3.8 / 3.7 系列为“混合思考模式，默认开启”，`enable_thinking` 开关；glm-5.3、kimi-k3 等“仅思考模式”无法关闭。[5]

### 3. 智谱 GLM（open.bigmodel.cn）
- 9 款核心模型覆盖文本、多模态理解、图像生成、视频生成、OCR、语音识别、语音合成、向量：GLM-5.3、GLM-5.3-Flash（原生理解图片视频）、GLM-Image、CogView-4、CogVideoX-3、GLM-ASR-2512、GLM-TTS、Embedding-3 等。[6]
- 思考：GLM-5.x / 4.7 默认开启，可 `thinking.type=disabled` 关闭；**GLM-5.3、GLM-5.3-Flash 强制思考不能关闭**。[7]
- 改图：模型概览页未列图像编辑模型，记“—”。

### 4. 火山方舟 / 豆包（ark.cn-beijing.volces.com）
- 文本 / 理解：doubao-seed-evolving、doubao-seed-2-1-pro/lite/turbo，能力标签“深度思考、文本生成、多模态理解、GUI、工具调用、结构化输出”；深度思考默认开启，Chat API `thinking.type=disabled` 关闭。[8]
- 生图：doubao-seedream-5-0-pro / 5-0-flash（文生图、单张图生图、多参考图生图、图层拆分）；视频：doubao-seedance-2-5 / 2-0 / 2-0-fast（含编辑、延长）；向量：doubao-embedding-vision-251215。[8]
- 配音 / 转写：方舟模型列表页未列，记“—”（豆包语音属另一产品线，不在本表口径内）。

### 5. DeepSeek（api.deepseek.com）
- `deepseek-flash`（DeepSeek-V4.1-Flash-1017）与 `deepseek-v4-pro`（V4-Pro-0813）；均支持非思考与思考模式（默认思考）；图像理解：flash 支持、v4-pro 不支持；旧名 `deepseek-v4-flash` 等路由到新模型。[9]

### 6. MiniMax（api.minimaxi.com / platform.minimaxi.com）
- 语言：MiniMax-M3.1-Flash（原生多模态、1M、思考深度可调）、MiniMax-M3；M2.5 / M2.7 2026-10-19 停止向新用户开放、11-18 下线。视频：MiniMax-H3、H3-Max、Hailuo-2.3(-Fast)、Hailuo-02；语音：speech-2.8-hd/turbo 等；图像：image-01（文生图、图生图）、image-01-live。[10]

### 7. 月之暗面 Kimi（api.moonshot.cn）
- kimi-k3.1-pro（原生视觉、1M）、kimi-k3、kimi-k2.7-code、kimi-k2.6（视觉与文本输入、思考与非思考）；K2 系列 2026-10-31 起停止向新用户开放，12 月底下线；moonshot-v1、kimi-k2.5 已下线。[11]
- 思考：k3.1-pro / k3 始终推理，用 `reasoning_effort` 调强度；k2.7-code 始终思考；k2.6 `thinking.type` 可关。[12]

### 8. OpenAI 兼容（自定义地址）
- 只有协议约定（/v1/chat/completions、/v1/models 等），没有统一的能力声明。App 只按模型名里明示的生成型能力点亮，其余由用户勾选，接入后跑一次探测验证（deviations-v1.1 V11-08）。

## 对 App 的影响（已核对，写入代码或 deviations 的位置）
- “思考”在多家都是同一模型的档位：DeepSeek、百炼、方舟、GLM、Kimi k2.6 可开关；GLM-5.3、Kimi k3/k3.1-pro、MiniMax M3.1-Flash 为**始终思考**。对话里的“深度思考”开关对这类模型关闭无效——App 关闭时不发送思考参数，计费与 trace 按服务商实际返回的 reasoning 用量记，不假设为 0。
- 单家覆盖最全的是百炼（9/9）与智谱（8/9）；MiMo 一家覆盖 5/9，与用户反问“市面上有分这么细的模型吗”一致：分细的只有生成型（生图 / 视频）与部分语音能力。
- 旧默认模型名需随下线更新：MiMo V2.5-Pro → mimo-v2.6-pro / flash；Kimi k2.5 / moonshot-v1 → kimi-k3 系列；MiniMax M2.x → M3 / M3.1-Flash。

## 来源（2026-10-24 打开）
1. https://mimo.mi.com/docs/zh-CN/api/model/list-models
2. https://mimo.mi.com/docs/zh-CN/news/latest/v2-6
3. https://mimo.mi.com/docs/zh-CN/api/audio/tts（2026-10-22 打开，见 design/refs-v9/README.md；本表沿用）
4. https://help.aliyun.com/zh/model-studio/models
5. https://help.aliyun.com/zh/model-studio/deep-thinking
6. https://docs.bigmodel.cn/cn/guide/start/model-overview
7. https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode
8. https://ark.volcengine.com/region:cn-beijing/docs/model-list（页面标注更新时间 2026-10-22）
9. https://api-docs.deepseek.com/zh-cn/quick_start/pricing
10. https://platform.minimaxi.com/docs/faq/models
11. https://platform.kimi.com/docs/models
12. https://platform.kimi.com/docs/guide/use-thinking-models
