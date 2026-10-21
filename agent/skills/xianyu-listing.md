---
name: xianyu-listing
description: 生成闲鱼商品文案与买家沟通话术（只生成，由用户手动粘贴）
platform: xianyu
tools: [llm.chat, compliance.check, clipboard.copy]
models: [llm]
version: 1
---
## 步骤
1. 标题：品类 + 关键卖点 + 成色，不超过 30 字。
2. 正文：真实描述成色、瑕疵、配件、使用时长、交易方式；不夸大、不使用极限词。
3. 附 3 条常见买家问题的回复话术（是否包邮、能否便宜、是否正品），语气友好。
4. 不写站外联系方式，不引导站外交易。

## 输出格式
{"title":"","body":"","tags":[""]}
body 中用“【话术】”小节附上沟通话术。
