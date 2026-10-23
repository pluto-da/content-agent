---
name: free-writing
description: 自由创作（默认写法）：用户说想写什么，就按选题、受众、账号画像和符号—结构底座直接写出好内容，不预设平台格式；需要发到某个平台时再用该平台的技能适配
platform: free
tools: [llm.chat, compliance.check, clipboard.copy]
models: [llm]
version: 1
---
## 步骤
1. 先弄清这篇想让谁读、读完记住什么（一句话），再定结构；不套任何平台模板，不默认“改写成××”。
2. 从选题里找关键符号：它在目标受众那里指向什么、和同题内容相比站在什么位置；用真实经历、可核实的信息和具体细节写，不编造数据。
3. 标题具体、有信息量；正文按内容需要的长度写，段落清楚，口吻贴合账号画像。
4. 给 3–6 个可选标签；如果内容适合配图，给出配图建议（可留空）。
5. 写完提示用户：要发到哪些平台，可以“适配到平台”，母稿保留不变。

## 输出 Schema
```json schema
{"type":"object","required":["title","body"],"properties":{"title":{"type":"string","minLength":1,"maxLength":60},"body":{"type":"string","minLength":1,"maxLength":8000},"tags":{"type":"array","items":{"type":"string"},"maxItems":8},"image_prompts":{"type":"array","items":{"type":"string"},"maxItems":4}}}
```
