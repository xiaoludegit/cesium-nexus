# Phase 2C: Experience Graph 实施计划

## 目标

Phase 2B 完成了 **Render Pipeline Intelligence + Skill Dispatch**：系统能按用户意图分发到合适的 Skill，并按 Skill 差异化组装 Context Pack v2。

Phase 2C 的核心定位是 **Experience Graph（经验图谱）**。在已有 ExperienceNode（Issue / PR Review / Forum 三类经验节点）基础上，建立节点间的关联边，形成可遍历的经验图谱。

```
构建 experience_edge 表（SQLite）
从 PR 的 closingIssueReferences 自动构建 "fixes" 边（PR → Issue）
提供图遍历查询（BFS / 链式回溯）
新增 get_experience_chain MCP tool
新增 cesium experience chain / stats CLI 命令
```

Phase 2C 完成后，系统应能对以下场景给出关联链路：

```
这个 Issue 是被哪个 PR 修复的？
这个 PR 关联了哪些 Issue？
从某个经验节点出发，追溯完整的 fix chain
图谱中有多少条 fixes 边？按类型分布如何？
```

---

## 关键设计决策

### 1. ExperienceEdge 仅建 "fixes" 确定性边

Phase 2C 仅构建 **确定性边**（从结构化数据直接推导）：

| 边类型 | 来源 | 说明 |
|---|---|---|
| `fixes` | PR body 中的 `closingIssueReferences` | PR → Issue 的修复关系 |

不构建 **推断性边**（需要语义分析或额外数据源）：

| 边类型 | 来源 | 归入 |
|---|---|---|
| `released_in` | GitHub Release 同步 | Phase 2C+ (Release 同步就绪后) |
| `references` | 文本相似度（embedding） | Phase 2D |
| `mentions` | 跨节点文本引用 | Phase 2D |
| `supersedes` | 版本演化分析 | Phase 2D |

### 2. Node ID 解析策略

现有 ExperienceNode ID 格式为 `{type}:{github_api_id}`（如 `issue:12345678`），而 PR 的 `closingIssueReferences` 存储的是 Issue **编号**（如 `#42`）。

为构建 fixes 边，需要将 `(repo, issueNumber)` 解析为 `issue:{github_api_id}`。

策略：

```
在 ExperienceRepo 新增 findByIds(ids: string[]): ExperienceNode[]
在 ExperienceRepo 新增 getAll(): ExperienceNode[]

在 PullRequestRepo 新增 getAllWithClosingRefs(): PullRequestRecord[]
  — 仅返回 closingIssueReferences.length > 0 的 merged PR

边构建时的 ID 解析：
  1. 从 IssueRepo 按 (repo, number) 查询 IssueRecord
  2. 用 IssueRecord.id 构造 node ID: issue:{id}
  3. 从 PR 构造 node ID: pr_review:{pr.id}
  4. 验证两端节点均存在于 experience_node 表后再建边
```

### 3. 图遍历：BFS + 深度限制

复用 `CallGraphRepo.getDownstream()` 已验证的 BFS 模式（visited set + queue），在 `ExperienceEdgeRepo` 上实现：

```
traverseBfs(startNodeId, direction, maxDepth) → ExperienceEdge[]
getExperienceChain(nodeId, experienceRepo) → ExperienceChain
```

### 4. 不引入向量检索（Qdrant 延后）

用户当前没有 Qdrant 环境。Phase 2C 仅使用 SQLite 关系查询构建确定性边。

Qdrant 向量检索延后到基础设施就绪后。届时部署步骤：

```bash
# 1. 启动 Qdrant
docker run -d -p 6333:6333 -p 6334:6334 \
  -v $(pwd)/data/qdrant_storage:/qdrant/storage \
  qdrant/qdrant

# 2. 创建 collection
curl -X PUT http://localhost:6333/collections/experience_embeddings \
  -H "Content-Type: application/json" \
  -d '{ "vectors": { "size": 768, "distance": "Cosine" } }'

# 3. 对 ExperienceNode.summary 做 embedding 写入
# 4. 用 cosine similarity > 0.85 推断 references 边
```

---

## 数据流

```
PR Sync（已有）
  → PullRequestRecord { closingIssueReferences: [42, 87] }
  → ExperienceNodeBuilder（已有） → experience_node 表

Edge Builder（Phase 2C 新增）
  → 遍历所有 closingIssueReferences 非空的 merged PR
  → 对每个 (PR, issueNumber):
       1. 查 IssueRepo 得到 IssueRecord → node ID = issue:{id}
       2. PR node ID = pr_review:{pr.id}
       3. 两端节点都存在 → INSERT experience_edge (type="fixes")
  → experience_edge 表

Graph Traversal（Phase 2C 新增）
  → 给定 node_id = issue:12345
  → BFS upstream: 找到 PR pr_review:67890 (fixes → issue:12345)
  → BFS downstream: 无（issue 不 fix 其他节点）
  → 返回 ExperienceChain { root, edges, nodes }
```

---

## 新增数据结构

### ExperienceEdge

```ts
export type ExperienceEdgeType = "fixes";
// 未来扩展: "released_in" | "references" | "mentions" | "supersedes"

export interface ExperienceEdge {
  id: string;                    // "{edgeType}:{sourceNodeId}:{targetNodeId}"
  sourceNodeId: string;          // 如 "pr_review:67890"
  targetNodeId: string;          // 如 "issue:12345"
  edgeType: ExperienceEdgeType;
  confidence: number;            // fixes = 1.0（确定性）; inferred < 1.0
  createdAt: string;
  metadata?: Record<string, unknown>;
}
```

### ExperienceChain

```ts
export interface ExperienceChain {
  rootId: string;
  nodes: ExperienceNode[];
  edges: ExperienceEdge[];
  depth: number;
  truncated: boolean;
}
```

### ExperienceEdgeStats

```ts
export interface ExperienceEdgeStats {
  totalEdges: number;
  byType: Record<ExperienceEdgeType, number>;
  connectedNodes: number;
  orphanNodes: number;
  totalNodes: number;
}
```

---

## 新增 / 修改文件清单

### 新建文件

| 文件 | 职责 |
|---|---|
| `packages/storage/src/experience-edge-repo.ts` | ExperienceEdge CRUD + BFS 遍历 |
| `packages/storage/src/experience-edge-repo.test.ts` | 边存储 + 遍历单元测试 |
| `packages/storage/src/experience-repo.test.ts` | 节点查询测试 |
| `packages/indexer/src/experience-edge-builder.ts` | 从 PR closingIssueReferences 构建 fixes 边 |
| `packages/indexer/src/experience-edge-builder.test.ts` | 边构建单元测试 |
| `packages/cli/src/commands/experience-cmd.ts` | experience CLI 命令组 |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `packages/shared/src/types.ts` | 新增 ExperienceEdge / ExperienceChain / ExperienceEdgeStats / ExperienceEdgeType |
| `packages/storage/src/schema.ts` | 新增 experience_edge 表 + 索引 |
| `packages/storage/src/index.ts` | 导出 ExperienceEdgeRepo |
| `packages/storage/src/experience-repo.ts` | 新增 findByIds / getAll 方法 |
| `packages/storage/src/pr-repo.ts` | 新增 getAllWithClosingRefs 方法 |
| `packages/storage/src/issue-repo.ts` | 新增 findByNumber 方法 |
| `packages/indexer/src/experience-node-builder.ts` | rebuildExperienceIndex 扩展为同时构建边 |
| `packages/indexer/src/index.ts` | 导出 edge builder 函数 |
| `packages/mcp/src/handlers.ts` | 新增 handleGetExperienceChain |
| `packages/mcp/src/server.ts` | 注册 get_experience_chain tool + repos 签名变更 |
| `packages/mcp/src/server.test.ts` | tools/list 验证 12 个工具 |
| `packages/mcp/src/e2e-stdio.test.ts` | tools/list 验证 12 个工具 |
| `packages/cli/src/index.ts` | 注册 experience 命令组 |

---

## 子里程碑

### P2C-1: shared types + SQLite 表 + ExperienceEdgeRepo

修改 `packages/shared/src/types.ts`，新增 ExperienceEdge / ExperienceChain / ExperienceEdgeStats 类型。

修改 `packages/storage/src/schema.ts`，新增 experience_edge 表：

```sql
CREATE TABLE IF NOT EXISTS experience_edge (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_edge_source ON experience_edge(source_node_id);
CREATE INDEX IF NOT EXISTS idx_edge_target ON experience_edge(target_node_id);
CREATE INDEX IF NOT EXISTS idx_edge_type ON experience_edge(edge_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_unique
  ON experience_edge(source_node_id, target_node_id, edge_type);
```

新建 `packages/storage/src/experience-edge-repo.ts`：

- `upsertMany(edges)` — 批量插入
- `getDownstream(nodeId, maxDepth)` — BFS 出边遍历
- `getUpstream(nodeId, maxDepth)` — BFS 入边遍历
- `getConnected(nodeId, maxDepth)` — 双向 BFS + 去重
- `totalCount()` / `countByType()` / `getStats(totalNodes)` — 统计
- `clear()` — 清空

测试：CRUD + BFS 深度限制 + 环路安全 + 统计。

**无依赖，可独立开始。**

### P2C-2: ExperienceRepo / PullRequestRepo / IssueRepo 扩展查询

- `ExperienceRepo.findByIds(ids)` — 批量查询
- `ExperienceRepo.getAll()` — 全量查询（edge builder 验证节点存在性）
- `PullRequestRepo.getAllWithClosingRefs()` — 返回有 closingIssueReferences 的 merged PR
- `IssueRepo.findByNumber(repo, number)` — 按 (repo, number) 查找 Issue

测试：各新增方法的正确性。

**无依赖，可与 P2C-1 并行。**

### P2C-3: Edge Builder — fixes 边构建

新建 `packages/indexer/src/experience-edge-builder.ts`：

- `buildFixesEdges(prRepo, issueRepo, experienceRepo)` — 从 PR closingIssueReferences 构建 fixes 边
- `rebuildExperienceGraph(issueRepo, prRepo, forumRepo, experienceRepo, edgeRepo)` — 全量重建（节点 + 边）

算法：
1. 获取所有 closingIssueReferences 非空的 merged PR
2. 获取所有 experience_node ID（Set）
3. 对每个 PR 的每个 closingIssueNumber:
   a. IssueRepo.findByNumber → IssueRecord
   b. sourceNodeId = `pr_review:{pr.id}`, targetNodeId = `issue:{issue.id}`
   c. 两端都在 Set 中 → 创建 fixes 边

**依赖 P2C-1 + P2C-2。**

### P2C-4: Graph Traversal — ExperienceChain 查询

在 `experience-edge-builder.ts` 中追加：

- `getExperienceChain(nodeId, experienceRepo, edgeRepo, maxDepth)` — 双向 BFS 遍历，返回 ExperienceChain

**依赖 P2C-1 + P2C-2。** 可与 P2C-3 并行。

### P2C-5: MCP Tool — get_experience_chain

- `handleGetExperienceChain(experienceRepo, edgeRepo, input)` — handler
- `registerTools` 签名新增 `experienceEdgeRepo`
- `createServer` 实例化 `ExperienceEdgeRepo`
- tools/list 返回 **12 个工具**（新增 `get_experience_chain`）

**依赖 P2C-4。**

### P2C-6: CLI — experience search / rebuild / chain / stats

新建 `packages/cli/src/commands/experience-cmd.ts`：

- `cesium experience search <keywords>` — FTS5 检索
- `cesium experience rebuild` — 全量重建节点 + 边
- `cesium experience chain <node_id>` — 查看经验链
- `cesium experience stats` — 图谱统计

**依赖 P2C-3 + P2C-4。**

### P2C-7: 全面测试

确保所有新建文件有对应测试，全量 `pnpm test` + `pnpm run build` 通过。

**依赖全部。**

### P2C-8: Docs 更新

README / CHANGELOG / future-roadmap 更新 Phase 2C 内容。

**依赖全部。**

---

## 依赖图

```
P2C-1 ──┬── P2C-3 ──┬── P2C-6 ─── P2C-7 ─── P2C-8
         │           │
P2C-2 ──┤── P2C-4 ──┤
         │           │
         └───────────┴── P2C-5
```

可并行：P2C-1 / P2C-2，P2C-3 / P2C-4。

---

## 延后功能（Deferred）

| 功能 | 归入 | 说明 |
|---|---|---|
| Qdrant 向量检索 | 基础设施就绪后 | 需 Docker 环境 |
| `released_in` 边 | Release 同步就绪后 | 需 GitHub Releases API |
| `references` / `mentions` / `supersedes` 边 | Phase 2D | 推断性边 |
| Problem Mining Pipeline | Phase 3 | 自动挖掘 |
| Cross-version Diff | Phase 3 | 版本比较 |

---

## 验收标准

```bash
pnpm test          # 全部通过
pnpm run build     # 9 包构建成功
```

### 核心验收场景

```bash
# 重建经验图谱
cesium experience rebuild
# → Rebuilt experience graph: Nodes: 42, Edges: 15

# 查看经验链
cesium experience chain "issue:12345"
# → Chain: [pr_review:67890] --[fixes]--> [issue:12345]

# 图谱统计
cesium experience stats
# → Nodes: 150, Edges: 35, Connected: 70, Orphan: 80
```

MCP tools/list 返回 12 个工具，`get_experience_chain` 可正常调用。

---

## Progress

| 子里程碑 | 内容 | 状态 |
|---|---|---|
| P2C-1 | shared types + experience_edge 表 + ExperienceEdgeRepo | ✅ 完成 |
| P2C-2 | ExperienceRepo / PullRequestRepo / IssueRepo 扩展查询 | ✅ 完成 |
| P2C-3 | Edge Builder — fixes 边构建 | ✅ 完成 |
| P2C-4 | Graph Traversal — ExperienceChain | ✅ 完成 |
| P2C-5 | MCP Tool — get_experience_chain | ✅ 完成 |
| P2C-6 | CLI — experience 命令组 | ✅ 完成 |
| P2C-7 | 全面测试 | ✅ 完成 |
| P2C-8 | Docs 更新 | ✅ 完成 |
