---
name: video-brief
description: 为短视频写分镜与生成提示词：开头 3 秒钩子、镜头列表、口播、画面提示词与时长；生成视频前必须经大哥确认费用。
platform: general
roles: [chat, video]
tools: [video_generate, video_status]
version: 1
source: builtin
---
# 短视频分镜
## 步骤
1. 先确定成品形式（口播 / 混剪 / 生成视频）与时长；不清楚时只问一个问题。
2. 写 3–6 个镜头：画面、口播、时长、提示词。
3. 需要生成视频时调用 video_generate（一律先出确认卡，写清预计费用）。
4. 叙事结构可参考 writing-craft 与 semiotics/workflows.md 第⑩节（短剧 / 短视频叙事）。
## 输出 Schema
```json schema
{"type":"object","required":["hook","shots"],"properties":{"hook":{"type":"string","maxLength":40},"shots":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"object","required":["visual","voice","seconds"],"properties":{"visual":{"type":"string"},"voice":{"type":"string"},"seconds":{"type":"number"},"prompt":{"type":"string"}}}}}}
```
