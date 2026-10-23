# 1.2.0 调研来源（核对日期 2026-10-24，Asia/Shanghai）

| # | 主题 | 来源 | 本项目采用的结论 |
|---|---|---|---|
| 1 | MCP 2026-07-28 规范（无状态核心） | https://modelcontextprotocol.io/specification/2026-07-28/changelog | 去掉 initialize 握手与会话；每个请求在 `_meta` 携带 `io.modelcontextprotocol/protocolVersion`；新增 `server/discover`（服务端必须实现，客户端可选调用）；MRTR：服务端返回 `resultType: "input_required"` + `inputRequests`，客户端带 `inputResponses` 重试原请求 |
| 2 | MCP Streamable HTTP（2026-07-28） | https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http | 单一 POST 端点；每个 POST 带 `MCP-Protocol-Version` 头且与 `_meta` 一致；去掉 GET 流与 `Mcp-Session-Id`；方法与工具名放 `Mcp-Method` / `Mcp-Name` 头 |
| 3 | MCP server/discover | https://modelcontextprotocol.io/specification/2026-07-28/server/discover | 结果含 `supportedVersions`、capabilities、serverInfo；客户端从中选版本 |
| 4 | MCP 2026-07-28 发布说明 | https://blog.modelcontextprotocol.io/posts/2026-07-28 | 同上；旧版本服务端（2025-11-25）仍需 initialize → notifications/initialized → 会话头，客户端需做兼容 |
| 5 | A2A v1.0 变化 | https://a2a-protocol.org/latest/whats-new-v1/ | JSON-RPC 方法改为 PascalCase：`SendMessage`（旧 `message/send`）；扩展卡 `GetExtendedAgentCard`；`capabilities.extendedAgentCard` |
| 6 | A2A Agent Card | https://a2a-protocol.org/latest/specification/ | 位于 `/.well-known/agent-card.json`；必填 name、description、supportedInterfaces[]（url / protocolBinding / protocolVersion）、version、capabilities、skills；securitySchemes 声明鉴权 |
| 7 | A2A v1.0 发布（Linux 基金会） | https://github.com/a2aproject/A2A/releases/tag/v1.0.0 | v1.0.0 正式版；签名 Agent Card 为可选 |
| 8 | 监督者 / 子 Agent 范式 | Claude Agent SDK subagents、OpenAI Agents SDK agents-as-tools / handoffs（执行者既有知识，截至 2026-05；本轮未重新打开页面核对） | 采用“监督者 + 子 Agent 作为工具”：子 Agent 有独立说明、工具白名单、模型；父级负责验收；交接用结构化输入输出 |
| 9 | 小米 MiMo 接口（实测，非文档核对） | https://api.xiaomimimo.com/v1 （OpenAI 兼容 chat/completions，模型 mimo-v2.6-flash；2026-10-24 收尾时真实调用 4 次，结果 evals/real/mimo-v1.2.json） | E21 实测走 App 同一套 callRole → mimo 适配器；价目按 shared/models/pricing.ts 计 |

说明：第 8 条未在本轮重新打开原页核对，标“未重新核对”；平台规格来源见 docs/refs-v1.2/platforms.md。

收尾核对（2026-10-24）：1.2.0 收尾未新增规格类来源；第 1–7 条沿用开工时的核对结果，第 8 条仍为“未重新核对”（deviations-v1.2 V12-11），第 9 条为实测记录。
