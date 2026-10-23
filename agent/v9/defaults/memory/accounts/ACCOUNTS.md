# accounts/ 账号画像
用途：每个平台一份账号画像（一个平台一个账号）。文件名：平台 id.md（xiaohongshu、douyin、channels、wechat-mp、xianyu、x、zhihu、bilibili、kuaishou）。
段落：定位、受众、风格、平台限制（字数 / 标签 / 画幅 / 外链）、偏好红线、历史表现（最多 10 条，每条带依据草稿与日期）。
加载：当前任务涉及某平台时载入该平台画像摘要。
读写：Agent 经 profile_update 提议，大哥“采纳”后写入。
