# 1.4.0 定版回归（本地，2026-10-24）

GitHub Actions 被账单拦截，以下为本机执行结果（out/ 不入库，数字摘自 out/vitest-*.json 与各脚本输出）。

| 套件 | 文件 | 测试 | 通过 | 失败 | 跳过 |
|---|---|---|---|---|---|
| shared（vitest） | 37 | 486 | 486 | 0 | 0 |
| web（vitest） | 25（1 个整文件跳过） | 354 | 348 | 0 | 6 |
| server（vitest） | 6 | 78 | 78 | 0 | 0 |
| evals（vitest，../evals） | 4 | 70 | 70 | 0 | 0 |

- eval-report：60/60 通过。
- vfs-doctor：0 问题（105 个文件，51 个文件夹）。
- 密钥扫描：git ls-files 未发现；构建产物见 CI 同名步骤；git 历史（+ 行，排除图片与 lock）8.3 MB——scan-secrets 对单文件 ≥ 5 MB 会静默跳过，本次按 4 MB 分 3 片扫描，未发现疑似密钥（见 deviations-v1.4 V14-10）。
- i18n-audit --strict：英文缺失 0、未知 id 0、t() 里写中文 0、TSX 写死中文 0。
- single-source-check：通过。
- eslint：0 错误、2 条警告（未使用的 eslint-disable，历史遗留）。
- web 单测第一次运行退出码 1（JSON 报告 success=true、0 失败，沙箱并发负载下运行），重跑退出码 0；以重跑为准。
