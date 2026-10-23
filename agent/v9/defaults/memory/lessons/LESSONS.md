# lessons/ 经验
用途：从发布与复盘里得到的经验。经验是证据记录，不是大哥的偏好。一条一个文件：L-YYYYMMDD-短名.md。
front matter：id、type: lesson、status（candidate / testing / effective / degraded / retired）、confidence（low / medium / high）、applies_to（平台、内容类型、账号阶段）、evidence（sample_size、content_ids、metrics_refs、control、window）、related（技能、实验 id）、created、last_validated。
正文四段：观察到的模式；结构假设（为什么会这样）；反证检查（第八条七问逐条回答，含“相关≠因果”的混杂因素）；结论与适用边界。
门槛：见根目录 EVOLUTION.md（n<5 或无对照只能 low；effective 需 n≥10 且有对照）。
加载：做选题、写作、复盘时按平台与内容类型检索；只用 testing / effective；degraded 只在复盘时出现。
读写：Agent 经 lesson_propose 提议，大哥确认（可批量）后写入；降级与废弃同样经提议确认。
