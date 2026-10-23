# hooks/ 事件钩子
用途：在 App 内部事件发生时，给 Agent 追加一段指令或触发一个本机动作。
可用事件：on-session-start、on-user-correction、on-tool-error、before-paid-call、before-publish-check、before-system-file-change、after-metrics-import、after-run-done。
可用动作（白名单）：追加提示（inject_note）、显示卡片（show_card）、写日志（log）、要求确认（require_confirm）。不能调用网络、不能操作平台、不能放宽审批与边界、不能执行代码。
格式：每个钩子一个 .md，front matter：event、enabled、actions；正文是追加给 Agent 的提示。
读写：大哥可开关和编辑；Agent 只能提议。
