---
name: douyin-script
description: 发到抖音时怎么写：口播脚本、配音与字幕要点
platform: douyin_script
tools: [llm.chat, compliance.check, clipboard.copy, handoff.deeplink]
models: [llm, tts, asr]
version: 1
---
## 步骤
1. 前 3 秒抛出钩子（具体问题或反常识事实），不标题党。
2. 正文按分镜写：【画面】……【口播】……，总时长 30–90 秒（约 150–400 字）。
3. 口播用口语短句，一句一个意思，便于字幕切分。
4. 单独输出 voiceover 字段：只包含要念出来的口播文字，用于语音合成。
5. 标题与 3–5 个话题。

## 输出格式
{"title":"","body":"","tags":[""],"voiceover":""}
