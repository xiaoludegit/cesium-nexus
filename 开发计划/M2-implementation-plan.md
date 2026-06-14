# M2: Source Retrieval — Implementation Plan

## Goal
在 M1 符号数据库之上实现源码检索能力：按名称查符号元数据、按 ID 读源码片段、FTS5 全文搜索。

## Environment
- **Database**: `./database/cesium.db`（M1 生成的 SQLite，含 symbols + symbols_fts）
- **Cesium source**: git submodule at `data/cesium/`
- **依赖**: M1 Symbol Index 已完成

## Implementation Steps

### Step 1: storage 扩展 — findById
在 `SymbolRepo` 中新增 `findById(id)` 方法，用于 `source` 命令根据符号 ID 定位文件路径和行号。

```typescript
findById(id: string): SymbolRecord | undefined
```

- 新增 prepared statement: `SELECT * FROM symbols WHERE id = ?`
- 返回单条记录或 `undefined`

### Step 2: CLI — symbol 命令
`cesium symbol <name>` — 按名称查找符号，展示完整元数据。

```
── Camera (class) ──
  ID:       9fb0e2b53d08
  File:     packages/engine/Source/Scene/Camera.js
  Lines:    81–254
  Exports:  default, DirectionUp, HeadingPitchRollValues, Camera
  Imports:  ../Core/BoundingSphere.js, ...
  Doc:      The camera is defined by a position, orientation, and view frustum.
```

实现：调用 `repo.findByName(name)` → 格式化输出每条记录的 ID、文件、行号、导出、导入、文档。

### Step 3: CLI — source 命令
`cesium source <symbolId>` — 按符号 ID 读取源码片段。

参数：
- `--cesium-root <path>` — Cesium 源码根目录（默认 `./data/cesium`）
- `--context <lines>` — 符号区域前后额外显示行数（默认 `0`）

实现：
1. `repo.findById(symbolId)` 获取符号的 `filePath`、`startLine`、`endLine`
2. `readFileSync(path.join(cesiumRoot, filePath))` 读取文件
3. 按行截取 `[startLine - 1 - context, endLine + context]`
4. 行号 + `>` 标记符号区域输出

### Step 4: CLI — search 命令
`cesium search <keyword>` — 源码全文搜索（默认搜索源码正文）。

参数：
- `--limit <n>` — 最大结果数（默认 `20`）
- `--name-only` — 仅搜索符号名和 doc comment（旧行为）

实现：默认调用 `repo.searchSource(keyword, limit)` 搜索源码正文，输出符号名、文件路径、行号、高亮 snippet。`--name-only` 时调用 `repo.searchFts()`。

> 📝 审核整改：原版 `search` 只搜索符号名/doc_comment，不搜索源码正文。整改后新增 `source_code` + `source_fts` 表，索引阶段读取每个符号的源码片段写入，`search` 默认搜索源码正文。

### Step 5: source_code + source_fts 表
- `source_code` 表：存储 symbol_id、name、file_path、start_line、end_line、code
- `source_fts` 虚拟表：FTS5 索引 `code` 列，关联 `source_code` 表
- 索引器在 `index:symbols` 阶段自动填充
- `SymbolRepo` 新增 `insertSourceFts()`、`searchSource()`、`clearSourceFts()`

### Step 6: 单元测试
- `symbol-repo.test.ts` 新增 5 个测试：
  - `findById` 正常查找
  - `findById` 不存在 ID 返回 `undefined`
  - `insertSourceFts` 批量插入
  - `searchSource` 源码正文搜索（搜 executeCommand 只出现在代码中）
  - `searchSource` 返回高亮 snippet
  - `searchSource` 空查询处理
  - `clearSourceFts` 清空数据

### Step 7: E2E 集成测试
- `e2e-source-retrieval.test.ts` — 对真实 Cesium 索引数据库的端到端验证（7 个测试）
- 使用 `describe.skipIf(!hasRealDb)` 在没有数据库时自动跳过
- 验证项：
  - Viewer/Scene/Camera 存在于符号表
  - Camera findById 返回正确元数据
  - `executeCommand` 仅在源码中出现，`findByName` 找不到但 `searchSource` 能找到
  - `Object.freeze` 等代码模式可被搜索到
  - snippet 包含 `>>>` `<<<` 高亮标记
  - searchSource 和 searchFts 返回不同类型的结果
  - source_code 表已正确填充

### Step 8: FTS5 查询词转义
> 📝 审核整改：原 `searchSource` 和 `searchFts` 的正则保留了 `.`，FTS5 将其解读为列引用语法（`column.term`），导致 `Object.freeze` 等含点号的查询报错。修复方式：将输入拆分为 alphanumeric token，每个用双引号包裹（如 `"Object" "freeze"`），防止 FTS5 特殊字符（`. * ^` 等）触发语法错误。

## Progress

| Step | 内容 | 状态 |
|---|---|---|
| 1 | storage findById | ✅ 完成 |
| 2 | CLI symbol 命令 | ✅ 完成 |
| 3 | CLI source 命令 | ✅ 完成 |
| 4 | CLI search 命令（源码全文搜索） | ✅ 完成 |
| 5 | source_code + source_fts 表 | ✅ 完成 |
| 6 | 单元测试 (13/13 passed) | ✅ 完成 |
| 7 | E2E 集成测试 (7/7 passed) | ✅ 完成 |
| 8 | FTS5 查询词转义 | ✅ 完成 |

## CLI 示例

```bash
cesium symbol Viewer
cesium source 45a23cf59985 --context 2
cesium search DrawCommand --limit 10
cesium search DrawCommand --name-only --limit 10
```

## Risk
- `source` 命令依赖本地文件系统，`--cesium-root` 必须指向已索引版本的 Cesium 源码
- FTS5 搜索对中文或特殊符号效果有限（MVP 可接受）
