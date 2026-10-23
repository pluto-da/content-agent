---
name: transcript-notes
description: 把录音或视频的转写文本提炼成要点（≤5 条），每条都能在原文找到依据；用于采访、口播素材、会议记录整理。
platform: general
roles: [asr, chat]
tools: [speech_transcribe]
version: 1
source: builtin
---
# 录音转写 → 要点
## 步骤
1. 没有转写文本时先调用 speech_transcribe（超出模型时长上限先提示切分）。
2. 通读转写，找出 3–5 个要点；每条附原文中的依据句（时间戳）。
3. 原文没有的内容不写进要点。
## 输出 Schema
```json schema
{"type":"object","required":["points"],"properties":{"points":{"type":"array","minItems":1,"maxItems":5,"items":{"type":"object","required":["text","evidence"],"properties":{"text":{"type":"string","maxLength":80},"evidence":{"type":"string"}}}}}}
```
