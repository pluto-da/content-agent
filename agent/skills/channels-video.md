---
name: channels-video
description: 把选题改写成视频号短视频文案，并生成配音与字幕
platform: channels
tools: [llm.chat, compliance.check, clipboard.copy, handoff.deeplink]
models: [llm, tts, asr]
version: 1
---
## 步骤
1. 视频号受众偏熟人社交与中年用户，语气稳重、可信，避免过度网络化表达。
2. 正文为短视频分镜口播稿，60–120 秒；另附 1–3 行视频描述文字。
3. voiceover 字段只放口播文字。
4. 话题 2–4 个。

## 输出格式
{"title":"","body":"","tags":[""],"voiceover":""}
