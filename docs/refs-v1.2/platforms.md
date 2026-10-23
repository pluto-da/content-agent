# 平台模板规格来源（核对日期 2026-10-24，Asia/Shanghai）

规则：只有本轮打开过官方帮助页 / 官方开发者文档、且页面明文写出的数字才标“已核实”（附来源与核对日期）；其余字段一律“待核实”，值留空。
沿用 1.1 代码（shared/src/platforms.ts）里的写作限制（小红书标题 20 / 正文 1000 / 标签 10、公众号标题 64、闲鱼标题 30、X 加权 280）只作为“建议值”写在说明里，**仍标待核实**，因为本轮没有重新打开这些平台的官方页面。

| 平台 | 字段 | 值 | 来源 | 状态 |
|---|---|---|---|---|
| YouTube | 标题字数 | 100 | https://support.google.com/youtube/answer/57404 （“Video titles have a character limit of 100 characters”） | 已核实 |
| YouTube | 正文（视频说明）字数 | 5000 | 同上（“Video descriptions have a character limit of 5,000 characters”） | 已核实 |
| Instagram | 正文（说明）字数 | 2200 | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media （“Maximum 2200 characters, 30 hashtags, and 20 @ tags”；帮助中心未写长度） | 已核实（开发者文档口径） |
| Instagram | 话题标签 | 每篇 ≤5 个 | https://help.instagram.com/351460621611097/ （“You can use up to 5 tags on a post”；开发者文档仍写 30，以帮助中心为准） | 已核实 |
| 抖音、小红书、视频号、公众号、知乎、闲鱼、X、B站、快手、微博、豆瓣、小宇宙 | 全部规格字段 | — | 本轮未打开官方帮助页 | 待核实 |
