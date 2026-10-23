# skills/ 技能
用途：可复用的做事方法。每个技能一个文件夹，必须有 SKILL.md，可带 references/（参考资料）与 templates/（模板）。
格式：SKILL.md front matter：name（小写连字符，≤64 字符）、description（做什么 + 什么时候用，≤1024 字符）、triggers（触发词）、platform、roles、tools、version、source（builtin / user）。
加载：本索引的“技能目录”每轮载入；命中后读 SKILL.md 正文；references/ 与 templates/ 用 skill_read 按需读。
读写：内置技能可编辑（编辑后标为 user 版本，可恢复默认）；用户可新建。用户技能优先于内置技能。Agent 只能经 skill_version_propose 提交新版本（改动对比 + 依据 lesson + 证据等级），用户确认后写入。
版本：每个技能的历史版本存 versions/v<N>.md，front matter 记 status（candidate / testing / effective / degraded / retired）与依据 lesson id；可任意回滚；degraded 与 retired 的技能不参与路由。
技能目录（自动生成：名称 —— 描述 —— 版本 —— 状态）
