#!/usr/bin/env node
/** 合并评测结果 → out/eval-report-0.9.0.json / .md（12.4 门槛：全部通过才允许打包）。 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const out = new URL('../out/', import.meta.url);
const load = (n) => (existsSync(new URL(n, out)) ? JSON.parse(readFileSync(new URL(n, out), 'utf8')) : []);
const golden = load('eval-golden.json'), behavior = load('eval-behavior.json');
const all = [...golden, ...behavior];
const pass = all.filter((r) => r.pass).length;
const report = { version: '0.9.0', generatedAt: new Date().toISOString(), mode: 'replay', total: all.length, pass, fail: all.length - pass, golden: { total: golden.length, pass: golden.filter((r) => r.pass).length }, behavior: { total: behavior.length, pass: behavior.filter((r) => r.pass).length, ruleOnly: behavior.filter((r) => r.judged === 'rule').map((r) => r.id) }, items: all };
writeFileSync(new URL('eval-report-0.9.0.json', out), JSON.stringify(report, null, 1));
const md = [`# 评测报告 0.9.0（回放模式）`, '', `- 生成时间：${report.generatedAt}`, `- 黄金任务：${report.golden.pass}/${report.golden.total}`, `- 行为评测：${report.behavior.pass}/${report.behavior.total}（其中 ${report.behavior.ruleOnly.length} 条为话术类，仅规则判官：${report.behavior.ruleOnly.join('、')}）`, `- 说明：对话模型由回放脚本替换；运行时、工具、审批、幂等、自检、边界、能力层（Mock 适配器）均为真实代码。真实模型的话术表现需用真 Key 复测。`, '', '| 编号 | 名称 | 结果 | 判定 | 证据 | 备注 |', '|---|---|---|---|---|---|', ...all.map((r) => `| ${r.id} | ${r.title} | ${r.pass ? '通过' : '失败'} | ${r.judged} | ${r.evidence} | ${(r.failures[0] ?? r.note ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 120)} |`)].join('\n');
writeFileSync(new URL('eval-report-0.9.0.md', out), md + '\n');
console.log(`eval: ${pass}/${all.length} 通过`);
if (pass !== all.length || all.length < 60) process.exit(1);
