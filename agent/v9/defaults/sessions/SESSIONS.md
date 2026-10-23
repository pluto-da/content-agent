# sessions/ 会话
每个会话一个文件夹：session.json（元数据）、transcript.jsonl（逐条消息与工具调用，系统追加写）、constraints.md（本会话的要求与纠正，每轮全量载入）、summary.md（压缩摘要）。
读写：系统写；大哥可在界面改标题、删会话（需确认）；constraints.md 大哥可编辑。
