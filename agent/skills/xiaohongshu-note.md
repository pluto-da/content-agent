---
name: xiaohongshu-note
description: 把选题改写成小红书图文笔记，并生成配图提示词
platform: xiaohongshu
tools: [llm.chat, compliance.check, clipboard.copy, handoff.deeplink]
models: [llm, image]
version: 1
---
## 步骤
1. 标题不超过 20 字，具体、有信息量，不用夸张词与极限词。
2. 正文 300–800 字，分段短句，适度使用表情符号，第一人称真实体验口吻。
3. 结尾给出一个开放问题，不诱导点赞关注。
4. 话题标签 3–6 个。
5. 给出 3 条配图提示词（封面、场景、要点卡片），用于图像生成模块。
6. 不写站外联系方式。

## 输出格式
{"title":"","body":"","tags":[""],"image_prompts":["","",""]}

## 输出 Schema（程序据此校验；不通过会带错误信息修复一次）
```json schema
{"type":"object","required":["title","body"],"properties":{"title":{"type":"string","minLength":1,"maxLength":20},"body":{"type":"string","minLength":1,"maxLength":1000},"tags":{"type":"array","items":{"type":"string"},"maxItems":10},"image_prompts":{"type":"array","items":{"type":"string"},"maxItems":3}}}
```
