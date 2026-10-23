#!/usr/bin/env python3
"""从 design/PROMPT-v9-models-agent.md 第八部分（8.8–8.10）逐字抽取 Agent 文件系统默认正文，
写入 app/agent/v9/defaults/<路径>。只在规格更新时由开发者运行（CI 不依赖 design/ 目录）。
用法：python3 app/scripts/extract-v9-defaults.py design/PROMPT-v9-models-agent.md
"""
import json, os, re, sys

spec_path = sys.argv[1]
root = os.path.join(os.path.dirname(__file__), '..', 'agent', 'v9', 'defaults')
t = open(spec_path, encoding='utf-8').read()
seg = t[t.index('### 8.8 根目录文件'):t.index('### 8.11 对应界面')]

out = {}
# 1) 根文件：~~~markdown 块，front matter 带 id
# 2) 文件夹入口 / 具体文件：前一行 **path** 标题
pattern = re.compile(r'(?:\*\*([^*\n]+?)\*\*[^\n]*\n)?(?:[^\n~`]*\n)?~~~markdown\n(.*?)\n~~~', re.S)
pos = 0
lines = seg.split('\n')
current_label = None
i = 0
while i < len(lines):
    line = lines[i]
    m = re.match(r'^\*\*([^*]+?)\*\*', line)
    if m:
        current_label = m.group(1).strip()
    if line.startswith('~~~markdown'):
        j = i + 1
        buf = []
        while not lines[j].startswith('~~~'):
            buf.append(lines[j]); j += 1
        body = '\n'.join(buf) + '\n'
        idm = re.search(r'^id:\s*(\S+)', body, re.M)
        path = None
        if idm and not body.startswith('---\nname:') and not body.startswith('---\nevent:'):
            path = idm.group(1) + '.md'
        elif current_label:
            path = re.sub(r'（.*$', '', current_label).strip()
        if not path:
            raise SystemExit(f'无法确定路径：{body[:80]}')
        out[path] = body
        current_label = None
        i = j + 1
        continue
    if line.startswith('```json') and current_label:
        j = i + 1
        buf = []
        while not lines[j].startswith('```'):
            buf.append(lines[j]); j += 1
        path = re.sub(r'（.*$', '', current_label).strip()
        out[path] = json.dumps(json.loads('\n'.join(buf)), ensure_ascii=False, indent=2) + '\n'
        current_label = None
        i = j + 1
        continue
    i += 1

out['subscriptions/heartbeat.json'] = json.dumps({"version": 1, "enabled": True, "time": "09:00", "timezone": "Asia/Shanghai", "onAppOpen": True}, ensure_ascii=False, indent=2) + '\n'
out['subscriptions/reminders.json'] = json.dumps({"version": 1, "items": []}, ensure_ascii=False, indent=2) + '\n'

for path, body in out.items():
    full = os.path.join(root, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(body)
print(json.dumps({'files': len(out), 'paths': sorted(out)}, ensure_ascii=False, indent=1))
