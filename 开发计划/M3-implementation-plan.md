# M3: Issue Index（GitHub Issue 本地索引）

目标：

建立 GitHub Issue 本地索引能力，为后续 Context Pack、Issue 关联源码分析、Issue 智能检索提供基础数据层。

---

## 总体原则

* 使用 SQLite
* 使用 FTS5
* 使用 Node.js 22 原生 fetch()
* 不引入 @octokit/rest
* 支持增量同步
* 支持全文搜索
* 支持 BM25 排序
* 支持多仓库扩展
* 不同步 Issue 评论
* PR 通过 pull_request 字段过滤

---

# Step 1：Storage 扩展

新增 issues 表

```sql
CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY,

    repo TEXT NOT NULL,

    number INTEGER NOT NULL,

    title TEXT NOT NULL,
    body TEXT,

    state TEXT,

    labels TEXT,
    assignees TEXT,

    author TEXT,

    comments INTEGER,

    created_at TEXT,
    updated_at TEXT,
    closed_at TEXT,

    html_url TEXT,

    UNIQUE(repo, number)
);
```

新增索引

```sql
CREATE INDEX IF NOT EXISTS idx_issues_state
ON issues(state);

CREATE INDEX IF NOT EXISTS idx_issues_updated
ON issues(updated_at);
```

---

新增 FTS5 表

采用与 source_fts 相同模式：

content-backed FTS5

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS issues_fts
USING fts5(
    title,
    body,
    content='issues',
    content_rowid='id'
);
```

---

新增同步触发器

insert

```sql
INSERT INTO issues_fts(rowid,title,body)
VALUES (new.id,new.title,new.body);
```

update

```sql
UPDATE issues_fts
SET title=new.title,
    body=new.body
WHERE rowid=new.id;
```

delete

```sql
DELETE FROM issues_fts
WHERE rowid=old.id;
```

保持与 M2 source_fts 实现一致。

---

# Step 2：Meta 游标

不要通过

```sql
MAX(updated_at)
```

计算同步游标。

新增 meta 表（如项目已存在则直接复用）

```sql
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

新增键：

```text
github_issues_last_sync
```

用于记录最近成功同步时间。

---

# Step 3：IssueRepo

新增：

```ts
IssueRepo
```

职责：

## upsertMany

```ts
upsertMany(records: IssueRecord[])
```

批量 UPSERT

使用事务

保证同步性能

---

## searchFts

```ts
searchFts(
  keyword: string,
  options?: {
      limit?: number
      state?: "open" | "closed"
  }
)
```

要求：

使用 FTS5 MATCH

使用 BM25 排序

```sql
ORDER BY bm25(issues_fts)
```

返回：

```ts
{
  issue: IssueRecord
  score: number
}
```

---

## lastUpdatedAt

从 meta 获取同步游标

```ts
getSyncCursor()
```

---

## setSyncCursor

```ts
setSyncCursor()
```

---

## clear

清空：

```sql
issues
issues_fts
```

用于全量重建。

---

# Step 4：GitHub Issue 拉取器

新增：

```text
src/github/github-issues.ts
```

核心接口：

```ts
syncIssues({
    owner,
    repo,
    token,
    since
})
```

不要写死仓库。

---

请求方式

Node 22 原生 fetch()

```ts
fetch(...)
```

---

API

```http
GET /repos/{owner}/{repo}/issues
```

参数：

```text
state=all
per_page=100
sort=updated
direction=asc
since=...
```

---

分页

解析：

```http
Link
```

自动翻页

直到结束。

---

PR过滤

GitHub Issues API 会返回 PR。

必须过滤：

```ts
if (item.pull_request) {
    continue
}
```

---

映射字段

```ts
IssueRecord
```

需要包含：

```ts
repo
number

title
body

state

labels
assignees

author

comments

created_at
updated_at
closed_at

html_url
```

---

进度输出

同步过程中打印：

```text
Fetching page 1...
Fetching page 2...

Indexed 100 issues...
Indexed 200 issues...
```

同步结束：

```text
Issue sync complete.
```

---

# Step 5：Rate Limit 处理

新增统一：

```ts
githubFetch()
```

负责：

* Authorization
* User-Agent
* 错误处理

读取：

```http
X-RateLimit-Remaining
X-RateLimit-Reset
```

当出现：

```http
403
429
```

输出：

```text
GitHub rate limit exceeded.
Reset in XX minutes.
```

并抛出明确异常。

---

# Step 6：CLI

新增：

```bash
sync:issues
```

参数：

```bash
--token
--full
```

行为：

默认：

```text
增量同步
```

读取：

```text
github_issues_last_sync
```

作为 since。

---

全量同步：

```bash
sync:issues --full
```

执行：

```text
IssueRepo.clear()
重新同步
```

---

同步成功：

更新：

```text
github_issues_last_sync
```

为当前时间。

---

# Step 7：Issue Search CLI

新增命令：

```bash
issue <keyword>
```

参数：

```bash
--limit
--state
```

示例：

```bash
issue shadow map

issue terrain --state open

issue atmosphere --limit 20
```

输出：

```text
#10452
Shadow map artifacts on terrain

state: open
updated: 2026-06-01

https://github.com/...
```

按 BM25 排序展示。

---

# Step 8：Shared Types

确认：

```ts
IssueRecord
```

已从 shared 导出。

如字段不足则扩展。

保持与数据库结构一致。

---

# Step 9：测试

必须包含：

## Unit Test

IssueRepo

覆盖：

* upsertMany
* searchFts
* clear
* sync cursor

---

## FTS Test

验证：

title 命中

body 命中

BM25 排序

state 过滤

---

## GitHub Mapper Test

验证：

Issue -> IssueRecord

PR 正确过滤

---

## E2E Test

流程：

```text
mock github api

sync:issues

issue shadow
```

验证：

* 数据入库
* FTS 生效
* CLI 输出正常

---

# 验收标准

以下命令全部通过：

```bash
sync:issues

sync:issues --full

issue terrain

issue shadow --state open
```

满足：

* 支持增量同步
* 支持全文搜索
* 支持 BM25 排序
* 支持 state 过滤
* 支持多仓库扩展
* 不依赖 octokit
* 不同步评论内容
* 测试全部通过
* lint 全部通过

## Progress

| Step | 内容 | 状态 |
|---|---|---|
| 1 | Storage 扩展 (issues + issues_fts + 索引) | ✅ 完成 |
| 2 | Meta 游标表 | ✅ 完成 |
| 3 | IssueRepo | ✅ 完成 |
| 4 | GitHub Issue 拉取器 | ✅ 完成 |
| 5 | Rate Limit 处理 | ✅ 完成 |
| 6 | CLI sync:issues | ✅ 完成 |
| 7 | CLI issue 搜索 | ✅ 完成 |
| 8 | Shared Types 扩展 | ✅ 完成 |
| 9 | 测试 (13 unit + 6 mapper = 19 passed) | ✅ 完成 |
| 10 | 审核整改 (5 P1/P2) | ✅ 完成 |

## 审核整改 (2026-06-15)

> 📝 审核整改：审核文档 `计划审核/M3-review-2026-06-15.md` 提出 2 个 P1 + 3 个 P2 问题，已全部修复。

### P1: 增量同步游标漏数
- 原实现：同步成功后写入 `new Date().toISOString()` 作为游标
- 修复：改为本轮返回结果中的 `max(updatedAt)`，无结果则保留旧游标

### P1: 多仓库游标未隔离
- 原实现：`github_issues_last_sync` 固定 key，所有仓库共用
- 修复：改为 `github_issues_last_sync:owner/repo`，按仓库隔离
- 新增测试：`should isolate sync cursors between different repos`

### P2: clear() 清理语义不完整
- 原实现：只删 `issues` 表
- 修复：`clear(repo?)` 支持按仓库清理 issues + 该仓库游标；`clear()` 清空所有 issues + 所有 issue 相关游标

### P2: --limit 缺少输入校验
- 修复：`Number.isInteger(limit) && limit > 0 && limit <= 1000`

### P2: 文档状态未同步
- 修复：README 中未实现能力（trace/context/status/MCP）标注为 Planned (M4–M6)
