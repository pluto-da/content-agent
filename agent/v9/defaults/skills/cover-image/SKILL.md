---
name: cover-image
description: 为笔记、视频、文章写配图与封面的生图提示词，并按平台选择画幅。需要配图、封面、插图时使用。
triggers: [配图, 封面, 插图, 出图]
roles: [image, imageEdit, vision]
tools: [image_generate, image_edit, image_understand]
version: 1
source: builtin
---
## 提示词结构
主体（谁 / 什么）+ 场景 + 构图（近景 / 俯拍 / 居中留白）+ 光线 + 风格（写实摄影 / 扁平插画 / 手账）+ 画面文字（如需，≤8 字，用引号标出）。
## 画幅
小红书 3:4；抖音与视频号 9:16；公众号封面 2.35:1，次图 1:1；X 16:9。模型不支持该比例时选最接近的并说明。
## 禁止
真实人物肖像、品牌商标、在世艺术家签名风格、血腥暴力、未授权的他人作品。
## 选封面
有看图模型时，用 image_understand 按“主体清晰、文字可读、与标题相关”三点打分选一张；没有就按第一张并说明。
