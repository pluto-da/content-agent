# data/ 业务数据
drafts、topics、hot-snapshots、metrics、inbox、usage、revenue、attribution、experiments 的 JSONL 视图（真正存储在各自的 IndexedDB 集合，这里是只读映射，便于导出与检索）。
revenue：只接受 revenue_record（用户表单提交事件）与 revenue_import（用户上传的官方导出文件，带文件名与 hash）两种来源，代码拒绝任何没有来源凭据的写入。drafts 每条带 revenueHypothesis（见 REVENUE.md）。metrics 每条带漏斗层字段（impressions、engagements、follows、conversions）与来源。
Agent 只经工具读写；不直接注入上下文。
