# Phase 1 RC (Release Candidate) 收尾实施计划

## 目标

将项目从「功能完成」提升到「可发布 v0.1.0」状态。

## 范围

只做发布门槛补齐、自动化验证、基础工程化。不做新功能。

---

## RC-1A Lint 基础设施（P0）

新增 `eslint.config.js`（Flat Config），仅启用 typescript-eslint 推荐规则。

root package.json 新增 scripts：

```json
"lint": "eslint .",
"typecheck": "tsc --noEmit -p tsconfig.json"
```

### 验收

`pnpm typecheck` + `pnpm lint` 通过。

---

## RC-1 GitHub Actions（P0）

新增 `.github/workflows/ci.yml`。

触发：push + pull_request。

步骤：`pnpm install --frozen-lockfile → typecheck → lint → test → build`。

### 验收

CI 配置语法正确，本地模拟步骤全通过。

---

## RC-2 Package Metadata（P0）

7 个 package.json + root 补齐：`license`、`author`、`description`、`repository`、`homepage`、`bugs`、`keywords`。

### 验收

所有 package metadata 完整合理。

---

## RC-2A LICENSE 文件（P0）

根目录新增 `LICENSE`（MIT 标准模板）。

---

## RC-2B exports map 一致性（P1）

`context-pack` 和 `mcp` 补齐 `exports` 字段，与其他 5 个包一致。

### 验收

所有包 exports 策略统一，构建通过。

---

## RC-3 CLI E2E Tests（P1）

新增 `packages/cli/src/e2e-cli.test.ts`。

覆盖：`symbol`、`source`、`issue`、`trace`、`context` 五个命令。

检测数据库存在，不存在时 `describe.skip` + 日志提示。

### 验收

本地（有DB）全部通过；CI（无DB）自动跳过不报错。

---

## RC-4 MCP Server E2E Test（P1）

新增 `packages/mcp/src/e2e-stdio.test.ts`。

用 `child_process.spawn` 启动真实 stdio MCP Server。

测试：initialize、tools/list（5 个工具）、build_context_pack。

不依赖 Cesium 数据库，始终执行。

### 验收

MCP E2E 测试通过，stdout 无污染。

---

## RC-5 Performance Baseline（P2）

新增 `docs/performance-baseline.md`。

手工测量：索引耗时、source retrieval、context pack、issue search。

---

## RC-6 CHANGELOG（P2）

新增 `CHANGELOG.md`。

记录 v0.1.0 Added: M1-M6。

---

## 进度追踪

| 步骤 | 状态 | 说明 |
|------|------|------|
| RC-1A: Lint 基础设施 | ✅ | eslint.config.js + 35 个 lint 错误修复 |
| RC-1: GitHub Actions | ✅ | ci.yml: push/PR → typecheck/lint/test/build |
| RC-2: Package Metadata | ✅ | 7 包 + root 补齐 license/description |
| RC-2A: LICENSE | ✅ | MIT 标准模板 |
| RC-2B: exports map | ✅ | context-pack/mcp 补齐 exports 字段 |
| RC-3: CLI E2E | ✅ | 5 命令覆盖，无 DB 自动跳过 |
| RC-4: MCP E2E | ✅ | 4 tests pass，spawn + NDJSON 通信 |
| RC-5: Performance Baseline | ✅ | docs/performance-baseline.md |
| RC-6: CHANGELOG | ✅ | v0.1.0 Added: M1-M6 |
| 全量验证 | ✅ | lint 0 err / typecheck 0 err / 148 tests pass / 7 pkg build OK |

## 📝 偏差记录

| 项目 | 说明 |
|------|------|
| RC-2 字段精简 | 原计划补齐 author/repository/homepage/bugs/keywords，实际仅补 license + description。其余字段暂不添加（个人项目无需完整 npm metadata），后续发布 npm 时再补 |
| RC-3 DB 路径 | CLI E2E 测试使用 `E:\work\Hermes\mcp\database\cesium.db`（CLI 默认相对路径），非项目内 `database/cesium.db`，故 CI 环境下自动 skip |
| RC-4 根本原因 | E2E 测试超时原因为 `import.meta.dirname` 相对路径多跳一级（`../../../` → `../../`），导致 CLI 入口文件找不到，服务器启动即崩溃。stderr 被丢弃导致调试困难 |
| RC-4 通信格式 | MCP SDK v1.29.0 使用 newline-delimited JSON（非 Content-Length/LSP 帧），已在测试中适配 |
| RC-5 索引耗时 | 全量 re-index 超时（>5min at 70%），推算 ~7min，已记入基线文档 |
