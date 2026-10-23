# subscriptions/ 定时与提醒
reminders.json：提醒列表（id、文本、时间或重复规则、北京时间、关联会话或草稿、状态）。heartbeat.json：心跳开关与时间。
规则：到点只发本机通知；点开进入对应会话或草稿；绝不在后台自动调用模型、访问平台、发布或花钱。
读写：Agent 经 reminder_create / reminder_cancel 写；大哥可在“我的 → 提醒”编辑。
