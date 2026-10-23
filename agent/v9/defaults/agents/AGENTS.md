# agents/ 子 Agent
用途：定义可被派生的子 Agent。每个文件一个子 Agent。
格式：Markdown + front matter：name、description、tools（白名单）、roles（需要的模型角色）、budget（步数 / 费用上限）、output（产物格式）。
命名：小写连字符.md。
加载：主 Agent 每轮只看本索引；派生某个子 Agent 时才读它的文件。
读写：用户可编辑和新增；Agent 只能提议修改。子 Agent 不能再派生子 Agent，不能使用任何对外写入或删除类工具。
索引（自动维护）：
- trend-scout：从合法热点来源与素材箱整理话题、给角度
- writer：按技能写稿、改写、格式化
- art-director：出配图提示词、生图、改图、选封面
- voice-producer：口播稿分句、配音、转写
- publisher-checklist：发布前质量门禁（含收益假设是否已挂）
- analyst：数据与收益复盘、漏斗诊断、归因与画像更新建议
- evolution-curator：从复盘中提炼 lessons，提技能新版本与系统文件修订建议（只提议）
