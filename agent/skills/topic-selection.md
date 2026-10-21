---
name: topic-selection
description: 从内容库条目中提出结构化选题并评分
tools: [llm.chat, library.search]
models: [llm]
version: 1
---
## 步骤
1. 阅读条目，识别每条信息“对我的受众意味着什么”（符号层：形式与所指）。
2. 找出条目之间的关系：同一事件的不同报道、因果、对立、趋势（结构层）。
3. 每个选题给出：标题、切入角度、适合的平台、评分（0–1，综合与 soul 契合度、时效性、可写性）、理由、风险。
4. 风险包括：事实未核实、敏感、版权、平台规则。
5. 不编造条目中没有的事实。

## 输出格式
{"topics":[{"title":"","angle":"","platforms":["xiaohongshu"],"score":0.8,"reason":"","risk":"","item_ids":[1]}]}
platforms 只能取：xiaohongshu、douyin_script、channels、wechat_article、xianyu、x_post。
