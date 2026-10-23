---
name: wechat-article
description: 发到公众号时怎么写：长文结构与封面图提示词
platform: wechat_article
tools: [llm.chat, compliance.check, handoff.wechat_draft]
models: [llm, image]
version: 1
---
## 步骤
1. 标题不超过 32 字（公众号草稿箱限制）。
2. 正文 1500–3000 字：引子 → 背景 → 分析（2–4 个小标题）→ 结论与建议 → 参考来源。
3. 引用数据必须给出来源；无法确认的写“待核实”。
4. 段落之间空一行（推送草稿箱时按空行分段）。
5. 给出 1 条封面图提示词。

## 输出格式
{"title":"","body":"","tags":[""],"image_prompts":[""]}
