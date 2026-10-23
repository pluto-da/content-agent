---
name: topic-semiotics
description: 用符号—结构方法判断选题、热点、标题和封面：关键符号指向什么、不同受众怎么读、在账号定位与同题内容里处于什么位置、该做不做以及怎么验证。做选题、比标题、选封面、判断热点值不值得做时使用。
triggers: [选题, 标题, 封面, 热点值不值得, 角度, 爆款分析, 符号, 解码]
roles: [chat, reason, vision]
tools: [hot_analyze, library_search, image_understand, metrics_summary]
references: [semiotics/PRINCIPLES.md, semiotics/decision-router.md, semiotics/core-models.md, semiotics/workflows.md]
version: 3
source: builtin
status: candidate
---
## 先判断深浅
只改一个标题或封面字 → 直接给 2–3 个版本（每版只改一处），不写分析、不加载 semiotics/。要决定做不做、主攻哪个方向 → 先读 semiotics/PRINCIPLES.md，再查 semiotics/decision-router.md 找到最像的一行，只加载该行列出的 1–3 个 semiotics/core-models.md 段落；最小步骤给不出可检验结论时，才按 semiotics/workflows.md 第①节完整执行。比标题 → 路由第 5、6 行与第②节；选封面或首帧 → 路由第 7、8 行与第⑧节（封面有看图模型时用 image_understand 读画面元素；同题已有角度可用 library_search）。

## 步骤（完整流程时）
1. 事实（P2）：列关键事实与来源，按证据类型标注（实拍或记录＝指示，官方说明＝规约，示意图＝像似，M07）；不能核实的写“未核实”。灾难、悲剧、未证实消息直接建议不做（M13）。
2. 符号解码（P1 P3 P4）：列 1–6 个关键符号（词、画面、数字、人物、梗），每个写字面意思、联想意思（M14）、目标受众 / 路人 / 反对者三种读法（M06、M19）、哪种读法有证据（评论原文、搜索词、数据），以及风险。
3. 代码、标签与联想（P3 P5）：目标受众用哪套圈层说法（M10）；圈层标签是谁命名的（M54）；会牵出哪些近期事件或刻板印象（M11）。
4. 结构位置（P1 P5）：主对立与真实存在的中介方案（M21）；必要时画四位方阵找被忽视的立场（M27）；与同题已有角度的差别（M03）；此刻各方关系与来龙去脉分开写（M04）。
5. 自然化与子码（P4）：哪些说法被当成理所当然、是谁的立场、有无反例（M15）；各方是否在用不同的评价维度（M40）；能否细分情形而不站两极（M43）。
6. 最小模型（P2）：目标、关键关系、约束、假设、缺的证据、成功标准（写成可观察效果，M36）、失败条件，各一行。
7. 结论先行：做 / 不做 / 换角度，一句理由；角度或标题给 1–3 版，标注用到的符号、模型编号与预计影响的漏斗层；写一句收益假设。
8. 反证：一句可观察的“什么情况说明我判断错了”（例如发布 48 小时内收藏低于账号同类中位数）。
9. 达标即停：有结论、至少一个有证据的角度、反证句，就交付；关键事实核实不了，停在“需要先核实什么”。

## 禁止
夸大、标题党（提出问题却不在正文回答）、极限词、诱导点赞关注分享、制造性别或地域等虚假对立、用他者贴的标签引战、蹭灾难与悲剧、未证实消息、伪造身份或体验、编造数据、模仿他人作品到可识别程度。符号分析只用于理解与表达，不用于欺骗或操纵受众。

## 输出 Schema
```json schema
{"type":"object","required":["verdict","reason","symbol_decode","structure","angles","revenue_hypothesis","falsifier"],"properties":{"verdict":{"enum":["do","skip","reframe"]},"reason":{"type":"string","minLength":1,"maxLength":200},"facts":{"type":"array","items":{"type":"object","required":["claim","source","status"],"properties":{"claim":{"type":"string"},"source":{"type":"string"},"status":{"enum":["verified","unverified"]}}}},"symbol_decode":{"type":"array","minItems":1,"maxItems":6,"items":{"type":"object","required":["signifier","denotation","connotation","readings","evidence_level"],"properties":{"signifier":{"type":"string","minLength":1},"denotation":{"type":"string"},"connotation":{"type":"string"},"readings":{"type":"object","required":["target","passerby","opponent"],"properties":{"target":{"type":"string"},"passerby":{"type":"string"},"opponent":{"type":"string"}}},"evidence_level":{"enum":["observed","hypothesis","supported"]},"evidence":{"type":"string"},"risk":{"type":"string"}}}},"structure":{"type":"object","required":["main_opposition","difference_vs_existing"],"properties":{"main_opposition":{"type":"string"},"mediator":{"type":"string"},"difference_vs_existing":{"type":"string"}}},"minimal_model":{"type":"object","properties":{"goal":{"type":"string"},"key_relations":{"type":"string"},"constraints":{"type":"string"},"assumptions":{"type":"string"},"missing_evidence":{"type":"string"},"success":{"type":"string"},"failure":{"type":"string"}}},"angles":{"type":"array","minItems":1,"maxItems":3,"items":{"type":"object","required":["text","symbols","models","funnel_layer"],"properties":{"text":{"type":"string","minLength":1},"symbols":{"type":"array","items":{"type":"string"}},"models":{"type":"array","items":{"type":"string"}},"funnel_layer":{"enum":["impression","engagement","follow","conversion","revenue"]}}}},"revenue_hypothesis":{"type":"string","minLength":1,"maxLength":120},"falsifier":{"type":"string","minLength":1,"maxLength":120}}}
```
