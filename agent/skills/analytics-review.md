---
name: analytics-review
description: 基于用户上传的平台数据做复盘，区分观察、推论与待验证
tools: [llm.chat, analytics.summarize]
models: [llm]
version: 1
---
## 步骤
1. 先说明样本量与数据来源；样本少于 10 条时只做观察。
2. 找出表现好与差的稿件的结构差异（标题、开头、长度、发布时间）。
3. 区分：观察到的模式 / 推论 / 待验证假设。
4. 给出 1–3 条可检验的改进建议，并说明如何验证。
