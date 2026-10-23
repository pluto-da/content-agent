---
event: before-system-file-change
enabled: true
actions: [require_confirm, show_card]
---
任何对系统文件或技能的写入（包括采纳进化提案、恢复默认、回滚）前：显示改动前后对比、依据、风险与回滚方式，等大哥点“确认生效”。目标是 BOUNDARIES.md 时直接拒绝。此钩子由代码强制，关闭开关无效。
