# config/ 配置
models.json（账号与角色绑定，只含 secretRef）、routing.json（按任务路由）、limits.json（步数、超时、并发、预算）、loading.json（加载表，由 SYSTEM.md 生成，只读）、ui.json（界面偏好）。
规则：JSON，带 $schema 与 version；由界面修改，代码校验后保存；不进入 Agent 上下文；Key 从不出现在这里。
