---
name: lesson-distill
description: 把复盘结论整理成经验（lessons），按证据门槛给置信度；同一打法达标时提技能新版本或系统文件修订建议；发现失效打法时提降级。复盘之后、用户说“以后都这么做”或“总结一下经验”时使用。
triggers: [总结经验, 以后都这么做, 经验, 打法, 沉淀, 进化]
roles: [reason]
tools: [library_search, experiment_log, lesson_propose, skill_version_propose, system_file_propose]
version: 1
source: builtin
status: candidate
---
## 步骤
1. 写经验草稿：模式、结构假设、样本量与内容 id、对照、反证检查（第八条七问）、适用条件。
2. 定置信度（EVOLUTION.md）：n<5 或无对照 → low（个案）；n≥5 有基线 → medium；n≥10 有对照且做过反证 → high。
3. 用户说“以后都这么做”但证据只有个案时：照他说的做这一次，记为个案，并提议做一次对照来验证；不要宣称这是规律。用户坚持把它定为长期偏好时，那是用户偏好（写进 memory/preferences），不是有效打法。
4. 打法达到 high → skill_version_propose：改动对比、依据 lesson、预期影响、回滚方式。
5. 涉及工作方式或灵魂 → system_file_propose；不得删改核心指令要点、不得放宽审批与红线；永不针对 BOUNDARIES.md。
6. 打法连续 3 次低于对照或基线 → 提降级。

## 输出
经验卡（待确认）与提案卡（改动对比，待确认）。确认前什么都不生效。
