# 后续计划 — cesium-nexus

> 起草时间：2026-06-23
> 第一版审核：2026-06-23（有条件通过，A-）
> v2 修订：吸收 5 个 P1 + 7 个 P2 审核意见（同日晚）
> v3 修订：2026-06-23，回填已完成工作的 commit hash，标注 W1 完成
> v4 修订：2026-06-24，W2 + W3 完成回填
> v5 修订：2026-06-25，Phase 2E 完成 + Phase 3 启动
> v6 修订：2026-06-25，Phase 3A1 集成测试完成
> v7 修订：2026-06-25，Phase 3A2 Shader Intelligence 完成
> 范围：Phase 2D 收尾 → Phase 2E（Problem Mining Pipeline）→ Phase 3（Code Intelligence）
> 状态：**执行中** — Phase 2E ✅ / Phase 3A1 ✅ / Phase 3A2 ✅ / Phase 3B 待启动

本文档是对 [`future-roadmap.md`](../future-roadmap.md) 的细化执行计划。

> **项目目标（审核锚点）：** 不是做一个 Cesium 百科，而是构建一个能够**持续提升诊断能力**的 Diagnosis System。所有 Phase 的设计与取舍都以此为判据。

---

## 0. 当前状态盘点

| 阶段 | 状态 | 备注 |
|---|---|---|
| Phase 2A Problem Diagnosis | ✅ 已验收（commit `d06e479`） | 含 P1 修复 + 239 tests |
| Phase 2B Render Pipeline Intelligence | ✅ 完成 | 12-stage DAG + 5 Skills |
| Phase 2C Experience Graph | ✅ 完成 | `fixes` 确定性边 + BFS |
| Phase 2C+ Qdrant Vector Search | ✅ 完成 | 384 维 ONNX embed + `references` 推断边 |
| Phase 2D Diagnosis Retrieval Enhancement | ✅ 完成 + 已发布 | commit `e04a5ea`，tag `v0.5.0`，297 tests |
| Phase 2E Problem Mining Pipeline | ✅ 验收通过 | commit `2f09eae`，408 tests |
| Phase 3A1 Version Intelligence | ✅ 集成测试完成 | commit `c93dd21`，426 tests |
| Phase 3A2 Shader Intelligence | ✅ 完成 | commit `0ac02ce`，434 tests |
| Phase 3B Evidence Fusion Engine | 🔲 待启动 | — |
| Phase 3C MCP Tools + Service Layer | 🔲 待启动 | — |

### 0.0 进度日志

| 时间 | 事项 | Commit |
|---|---|---|
| 2026-06-23 | Phase 2D 收尾 — commit + tag `v0.5.0` | `e04a5ea` / `c69ab03` / `aa050c8` |
| 2026-06-23 | Phase 2D Review 通过（无 P1，2 个 P2 环境项） | [`计划审核/Phase2D-review-2026-06-23.md`](../计划审核/Phase2D-review-2026-06-23.md) |
| 2026-06-23 | P2-1 + P2-2 sharp graceful（dynamic import + CLI friendly error） | `6e81c48` |
| 2026-06-23 | Phase 2E W1 — `@cesium-nexus/mining` 包脚手架 + 4 层架构 | `ae32352` |
| 2026-06-24 | Phase 2E W2 — LLMBackend + Drafter + Scorer + Pipeline | `35dfb60` |
| 2026-06-24 | Phase 2E W3 — Promoter + Review CLI + 6 个新子命令 | `ddb3bbd` |
| 2026-06-24 | Phase 2E W4 — 真实数据挖掘 + Coverage 基线 | `8eae620` |
| 2026-06-24 | Phase 2E W5 — Issue Intent Classification | `8467713` |
| 2026-06-24 | Phase 2E Review 通过 | [`计划审核/Phase2E-review-2026-06-24.md`](../计划审核/Phase2E-review-2026-06-24.md) |
| 2026-06-25 | Phase 3 Architecture Freeze v1.0 | `06c6bf7` |
| 2026-06-25 | Phase 3 Implementation Plan v1.1 | `36b53fc` |
| 2026-06-25 | Phase 3A1 — Version Intelligence foundation | `d565861` |
| 2026-06-25 | Phase 3A1 — Integration tests (18 tests) | `c93dd21` |
| 2026-06-25 | Phase 3A2 — Shader Intelligence | `0ac02ce` |

---

## 1. Phase 2E 完成回顾

### 1.1 验收结果

| 指标 | 目标 | 实际 | 状态 |
|------|------|------|------|
| Intent Filter 生效 | — | 238 issues filtered (non-bug) | ✅ |
| Feature Request 被过滤 | — | 18% sample (9/50) | ✅ |
| Coverage ≥ 39.05% | ≥ 39.05% | **39.05%** | ✅ |
| 无 Diagnosis Recall 下降 | — | Coverage 相同 | ✅ |

---

## 2. Phase 3 — Code Intelligence

### 2.1 架构设计

详见 [`docs/architecture/phase3-architecture.md`](../docs/architecture/phase3-architecture.md)

### 2.2 实施计划

详见 [`开发计划/Phase3-implementation-plan.md`](./Phase3-implementation-plan.md)

| 阶段 | 周次 | 任务 | 状态 |
|------|------|------|------|
| Phase 3A1 | W1-W2 | Version Intelligence | ✅ 完成 |
| Phase 3A2 | W3 | Shader Intelligence | ✅ 完成 |
| Phase 3B | W4-W5 | Evidence Fusion Engine | 🔲 待启动 |
| Phase 3C | W6 | MCP Tools + Service Layer | 🔲 待启动 |

### 2.3 Phase 3A1 完成内容

**commit `d565861` + `c93dd21`：**

| 模块 | 文件 | 说明 |
|------|------|------|
| 包脚手架 | `packages/intelligence/` | 新包 @cesium-nexus/intelligence |
| Identity (RC-002) | `identity.ts` | SHA1(kind + fullyQualifiedName) 生成稳定 symbol_id |
| Snapshot Repository | `snapshot-repo.ts` | symbol_snapshot + breaking_change 表 |
| Snapshot Builder | `snapshot-builder.ts` | 扫描 Cesium 源码生成版本快照 |
| Symbol Diff Engine | `symbol-diff-engine.ts` | 两版本 Symbol Diff + Identity Stability 计算 |
| Breaking Change Detector | `breaking-change-detector.ts` | 检测 removed/renamed/signature_changed |
| CLI | `version-cmd.ts` | `cesium snapshot` / `cesium diff` 命令 |
| 集成测试 | `intelligence.test.ts` | 18 个测试覆盖全链路 |

### 2.4 Phase 3A2 完成内容

**commit `0ac02ce`：**

| 模块 | 文件 | 说明 |
|------|------|------|
| Shader Types | `shader-types.ts` | ShaderSymbol / ShaderIndex / ShaderFilters 类型 |
| Shader Repository | `shader-repo.ts` | shader_symbol 表 CRUD + 搜索 + 统计 |
| GLSL Scanner | `glsl-scanner.ts` | 扫描 GLSL 文件提取 shader symbols |
| Shader Index Builder | `shader-index-builder.ts` | 构建和管理 shader 索引 |
| Shader-JS Linker | `shader-js-linker.ts` | 将 shader 关联到 JS symbols |
| CLI | `shader-cmd.ts` | `cesium shader` 命令 |
| 集成测试 | `shader.test.ts` | 8 个测试 |

**新增 CLI 命令：**

```bash
# Shader 查询
cesium shader --name czm_model
cesium shader --type uniform
cesium shader --file ModelVS.glsl
cesium shader --related Model
cesium shader --stage model

# 索引管理
cesium shader --rebuild
cesium shader --stats
```

---

## 3. 下一步

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 1 | Phase 3B Evidence Fusion Engine | 🔲 待启动 | 待用户指令 |
| 2 | Phase 3C MCP Tools + Service Layer | 🔲 | 待 Phase 3B 完成 |

**当前阻塞：无。待用户指令进入 Phase 3B。**
