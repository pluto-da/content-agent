---
name: revenue-review
description: 按收益做复盘：汇总大哥录入或导入的收入与漏斗数据，按收入排序，诊断最弱的漏斗层，分开显示四种归因，给可验证的下一步。用户要复盘、看这周 / 这月赚了多少、哪篇最赚钱时使用。
triggers: [复盘, 赚了多少, 收入, 收益, 哪篇最赚钱, 数据分析]
roles: [chat, reason]
tools: [revenue_summary, funnel_summary, metrics_summary, attribution_compute, experiment_log]
version: 1
source: builtin
status: candidate
---
## 步骤
1. 取数：只用 revenue_summary / funnel_summary / metrics_summary 的结果。没有收入记录 → 直接说“这段时间还没有收入数据”，给“录入 / 导入”按钮，然后按漏斗层复盘。
2. 排序：按收入（direct + user_tagged 在前，allocated 标“分摊估计”，unattributed 单列）；无收入时按最接近收入的层。
3. 诊断：哪一层掉得最多？对照账号近 30 天同类中位数。
4. 解释：先列观察到的模式 → 再提结构假设 → 反证检查（其他解释？混杂因素：热点、时段、平台调整？样本够吗？）。n<5 写“样本太少，结论仅供参考”；n<10 或无对照写“相关≠因果”。
5. 下一步：1–3 个可验证的动作，每个带收益假设与验证时间。
6. 经验：有值得记的，交给 lesson_propose（不自动写入）。

## 禁止
编造或估算未录入的收入；把分摊结果说成事实；用单篇爆款下规律结论。

## 输出 Schema（v9.2 新增；与 semiotics/workflows.md 第⑥节同源，步骤 4 的结构假设可调用 semiotics/core-models.md 的 M05、M09、M17、M24 与 R2）
```json schema
{"type":"object","required":["data_scope","observations","hypotheses","falsification","next_actions"],"properties":{"data_scope":{"type":"object","required":["source","window","n","caveat"],"properties":{"source":{"enum":["user_input","official_export"]},"window":{"type":"string"},"n":{"type":"integer","minimum":0},"caveat":{"type":"string"}}},"observations":{"type":"array","items":{"type":"object","required":["pattern","refs"],"properties":{"pattern":{"type":"string"},"refs":{"type":"array","items":{"type":"string"}}}}},"hypotheses":{"type":"array","minItems":1,"maxItems":3,"items":{"type":"object","required":["h","if_true_expect","evidence_level"],"properties":{"h":{"type":"string"},"if_true_expect":{"type":"string"},"models":{"type":"array","items":{"type":"string"}},"evidence_level":{"enum":["hypothesis","supported"]}}}},"falsification":{"type":"object","required":["alternatives","confounders","would_refute","beyond_evidence"],"properties":{"alternatives":{"type":"array","minItems":1,"items":{"type":"string"}},"confounders":{"type":"array","minItems":1,"items":{"type":"string"}},"would_refute":{"type":"array","minItems":1,"items":{"type":"string"}},"simpler_model":{"type":"string"},"beyond_evidence":{"type":"string"}}},"history_factors":{"type":"array","items":{"type":"string"}},"next_actions":{"type":"array","minItems":1,"maxItems":3,"items":{"type":"object","required":["action","revenue_hypothesis","control","check_at"],"properties":{"action":{"type":"string"},"revenue_hypothesis":{"type":"string"},"control":{"type":"string"},"check_at":{"type":"string"}}}}}}
```
