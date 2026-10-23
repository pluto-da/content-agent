---
name: x-post
description: 发到 X 时怎么写：280 字符以内的帖子
platform: x_post
tools: [llm.chat, compliance.check, handoff.x_intent]
models: [llm]
version: 1
---
## 步骤
1. 正文不超过 280 字符（中文约 140 字），一个核心观点。
2. 可附 1–2 个话题标签。
3. 如需展开，另给出 2–4 条串帖内容，放在 body 中用“---”分隔。

## 输出格式
{"title":"","body":"","tags":[""]}

## 输出 Schema（每段按 X 规则计长：中文按 2、其余按 1，单段 ≤ 280）
```json schema
{"type":"object","required":["body"],"properties":{"title":{"type":"string","maxLength":60},"body":{"type":"string","minLength":1,"x-weightedMax":280,"x-segmentSep":"---"},"tags":{"type":"array","items":{"type":"string"},"maxItems":4}}}
```
