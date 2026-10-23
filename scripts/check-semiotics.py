#!/usr/bin/env python3
"""C52–C56 静态检查（底座 2.0）。
C52 文件存在且可加载；C53 选题 Schema 含符号解码、流程数；C54 复盘 Schema 含反证；
C55 引文合规（合计 ≤35、单条 ≤30 字、紧跟〔书名·章节〕、索绪尔只引已逐字重核的章节）；
C56 路由表覆盖全部流程、每行 ≤3 个模型且模型都存在。另查 PRINCIPLES.md ≤8000 字。
用法：python3 design/semiotics-distill/check-semiotics.py [app/agent 路径]"""
import json, re, sys, pathlib

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'app/agent')
sem = root / 'semiotics'
files = ['SEMIOTICS.md', 'PRINCIPLES.md', 'decision-router.md', 'core-models.md', 'workflows.md',
         'conflicts-and-limits.md', 'sources.md']
problems = []
CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫'

# C52 存在且可加载
for f in files:
    p = sem / f
    if not p.exists():
        problems.append(f'C52 缺文件 {p}'); continue
    s = p.read_text(encoding='utf8')
    m = re.match(r'^---\n(.*?)\n---\n', s, re.S)
    if not m:
        problems.append(f'C52 {f} 缺 front matter'); continue
    fm = dict(l.split(':', 1) for l in m.group(1).splitlines() if ':' in l)
    for k in ('id', 'type', 'load'):
        if k not in fm: problems.append(f'C52 {f} front matter 缺 {k}')
    if fm.get('load', '').strip() != 'on_demand': problems.append(f'C52 {f} load 应为 on_demand')
skill = root / 'skills' / 'topic-semiotics.md'
if not skill.exists(): problems.append('C52 缺 skills/topic-semiotics.md')
else:
    st = skill.read_text(encoding='utf8')
    for need in ('semiotics/PRINCIPLES.md', 'semiotics/decision-router.md'):
        if need not in st: problems.append(f'C52 topic-semiotics 未引用 {need}')
for f in ('soul.md', 'working-method.md'):
    t = (root / f).read_text(encoding='utf8')
    if 'semiotics/' not in t: problems.append(f'C52 {f} 未指向 semiotics/')
    if 'PRINCIPLES.md' not in t: problems.append(f'C52 {f} 未写先加载 PRINCIPLES.md')

# PRINCIPLES 字数上限（正文非空白字符）
pr_body = (sem / 'PRINCIPLES.md').read_text(encoding='utf8').split('---', 2)[2]
pr_len = len(re.sub(r'\s', '', pr_body))
if pr_len > 8000: problems.append(f'PRINCIPLES.md 正文 {pr_len} 字，超过 8000')

def blocks(p):
    return [json.loads(b) for b in re.findall(r'```json(?: schema)?\n(.*?)\n```', p.read_text(encoding='utf8'), re.S)]

# C53
sk = blocks(skill)
if not sk or 'symbol_decode' not in sk[0].get('required', []): problems.append('C53 topic-semiotics Schema 未要求 symbol_decode')
wf_text = (sem / 'workflows.md').read_text(encoding='utf8')
wf_heads = re.findall(r'(?m)^## ([' + CIRCLED + '])', wf_text)
wf = blocks(sem / 'workflows.md')
if len(wf) != len(wf_heads) or len(wf) < 10: problems.append(f'C53 流程数 {len(wf_heads)} 与 Schema 数 {len(wf)} 不符或少于 10')
elif 'symbol_decode' not in wf[0]['required']: problems.append('C53 流程① Schema 未要求 symbol_decode')
# C54
if len(wf) >= 6:
    r = wf[5]
    if 'falsification' not in r['required']: problems.append('C54 流程⑥ Schema 未要求 falsification')
    else:
        for k in ('alternatives', 'confounders', 'would_refute'):
            if k not in r['properties']['falsification']['required']: problems.append(f'C54 falsification 缺 {k}')
for i, (h, b) in enumerate(zip(wf_heads, wf)):
    sec = wf_text.split('## ' + h, 1)[1].split('\n## ', 1)[0]
    for need in ('**输入**', '**输出 Schema**', '自检', '**停止条件**'):
        if need not in sec: problems.append(f'C53 流程{h} 缺 {need}')

# C55 引文合规
SAUSSURE_OK = ('第一编第一章', '第二编第四章', '第二编第五章', '第二编第六章', '第三编第四章')
quotes = []
for f in files + ['../skills/topic-semiotics.md', '../soul.md', '../working-method.md']:
    s = (sem / f).read_text(encoding='utf8')
    for m in re.finditer(r'「([^」]*)」(〔([^〕]*)〕)?', s):
        quotes.append((f, m.group(1), m.group(3)))
for f, q, c in quotes:
    if len(q) > 30: problems.append(f'C55 超长引文({len(q)}字) {f}: {q}')
    if not c or '·' not in c: problems.append(f'C55 引文缺出处 {f}: {q}')
    elif ('索绪尔' in c or '普通语言学教程' in c) and not any(k in c for k in SAUSSURE_OK):
        problems.append(f'C55 索绪尔引文须出自已逐字重核章节 {f}: {c}')
    if f != 'core-models.md': problems.append(f'C55 引文只应出现在 core-models.md：{f}: {q}')
if len(quotes) > 35: problems.append(f'C55 引文合计 {len(quotes)} 条，超过 35')
reg = re.search(r'原文短引登记（合计 (\d+) 条', (sem / 'sources.md').read_text(encoding='utf8'))
if not reg or int(reg.group(1)) != len(quotes): problems.append(f'C55 sources.md 登记数与实际 {len(quotes)} 不符')

# C56 路由覆盖
cm = (sem / 'core-models.md').read_text(encoding='utf8')
model_ids = set(re.findall(r'(?m)^### (M\d{2}|R\d)\b', cm))
rt = (sem / 'decision-router.md').read_text(encoding='utf8')
rows = [l for l in rt.splitlines() if re.match(r'^\| \d+ \|', l)]
covered = set()
for l in rows:
    cells = [c.strip() for c in l.strip('|').split('|')]
    ms = re.findall(r'\b(M\d{2}|R\d)\b', cells[3])
    if not 1 <= len(ms) <= 3: problems.append(f'C56 路由第 {cells[0]} 行模型数 {len(ms)}（应 1–3）')
    for mid in ms:
        if mid not in model_ids: problems.append(f'C56 路由第 {cells[0]} 行引用不存在的模型 {mid}')
    covered |= set(re.findall('[' + CIRCLED + ']', cells[-1]))
missing = [h for h in wf_heads if h not in covered]
if missing: problems.append(f'C56 路由表未覆盖流程 {"".join(missing)}')

print(json.dumps({'quotes': len(quotes), 'max_len': max((len(q) for _, q, _ in quotes), default=0),
                  'principles_chars': pr_len, 'models': len(model_ids), 'workflows': len(wf_heads),
                  'router_rows': len(rows), 'problems': problems, 'pass': not problems}, ensure_ascii=False, indent=1))
sys.exit(1 if problems else 0)
