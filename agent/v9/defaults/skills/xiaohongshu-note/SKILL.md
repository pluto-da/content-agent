---
name: xiaohongshu-note
description: 发到小红书时怎么写：图文笔记与 3 条配图提示词。用户指定小红书、种草笔记、图文笔记，或把母稿适配到小红书时使用。
triggers: [小红书, 笔记, 种草, 图文]
platform: xiaohongshu
roles: [chat, image]
tools: [draft_write, image_generate, publish_check]
version: 3
source: builtin
status: effective
---
## 步骤
1. 先定本篇标准：标题 ≤20 字；正文 300–800 字；标签 3–6 个；画幅 3:4。写一句收益假设（格式见 REVENUE.md）。
2. 标题具体、有信息量，不用夸张词与极限词。
3. 正文分段短句，第一人称真实体验口吻，适度表情；结尾一个开放问题，不诱导点赞关注；不写站外联系方式。
4. 给 3 条配图提示词（封面、场景、要点卡），写法见 skills/cover-image。
5. 平台规则细节需要时读 references/platform-rules.md；结构参考 templates/note.md。

## 输出 Schema
```json schema
{"type":"object","required":["title","body","tags","image_prompts","revenue_hypothesis"],"properties":{"revenue_hypothesis":{"type":"string","minLength":1,"maxLength":120},"title":{"type":"string","minLength":1,"maxLength":20},"body":{"type":"string","minLength":1,"maxLength":1000},"tags":{"type":"array","items":{"type":"string"},"minItems":3,"maxItems":6},"image_prompts":{"type":"array","items":{"type":"string"},"minItems":3,"maxItems":3}}}
```
