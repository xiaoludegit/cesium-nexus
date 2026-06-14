# M1: Symbol Index — Implementation Plan

## 进度追踪

| Step | 内容 | 状态 |
|---|---|---|
| 1 | Monorepo 脚手架 | ✅ 完成 |
| 2 | packages/shared 类型定义 | ✅ 完成 |
| 3 | packages/parser Symbol Extractor | ✅ 完成 |
| 4 | packages/storage SQLite 存储层 | ✅ 完成 |
| 5 | packages/indexer 源码扫描器 | ✅ 完成 |
| 6 | packages/cli Commander 入口 | ✅ 完成 |
| 7 | 测试 (vitest) — 12/12 passed | ✅ 完成 |
| 8 | 验收 (Viewer/Scene/Camera) — 3556 symbols | ✅ 完成 |

## Goal
Build a Cesium symbol database by scanning source code, extracting Class/Function/Method/Enum/Constant symbols, and storing them in SQLite.

## Environment
- **Cesium source**: git submodule at `data/cesium/` (CesiumGS/cesium), version switchable via `git submodule`
- **Scan scope**: `packages/engine/Source/` + `packages/widgets/Source/` (relative to cesium root)
- **Exclude**: `ThirdParty/`, `Shaders/`, `Workers/`, `Specs/`, `Assets/`
- **Default cesium-root**: `./data/cesium` (configurable via CLI `--cesium-root`)
- **Runtime**: Node.js 22.18.0, pnpm 10.15.0

## Cesium Code Patterns (from source inspection)
1. **Function constructors** with `@alias` JSDoc → extract as `class` (Camera, Scene, Primitive)
2. **ES6 class** declarations → extract as `class` (newer code: BufferLoader, etc.)
3. **Prototype methods** `ClassName.prototype.method = function()` → extract as `method`
4. **ES6 class methods** inside class body → extract as `method`
5. **Enums**: `const X = { ... }` with `@enum` + `Object.freeze()`/`Frozen()` → extract as `enum`
6. **Standalone functions**: `function foo()` + `export` → extract as `function`
7. **Constants**: exported values with `@constant` → extract as `constant`
8. All files use ES module `import`/`export` syntax

## Implementation Steps

### Step 1: Monorepo Scaffold
Create the pnpm workspace structure per plan.md:

```
cesium-nexus/
├── packages/
│   ├── shared/src/types.ts          # SymbolRecord, Edge, etc.
│   ├── parser/src/symbol-extractor.ts
│   ├── storage/src/{schema,symbol-repo}.ts
│   ├── indexer/src/cesium-source.ts
│   ├── cli/src/{index,commands/index-cmd}.ts
│   ├── mcp/                         # Empty scaffold for M1
│   └── context-pack/                # Empty scaffold for M1
├── data/cesium/
├── database/
├── docs/
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── tsconfig.json
```

- Root `package.json`: workspace scripts (build, test, dev)
- `tsconfig.base.json`: shared TS config (strict, ESNext, NodeNext)
- Each package: `package.json` + `tsconfig.json` + `src/index.ts`
- Build: **tsup** (per package, outputs to `dist/`)
- Test: **vitest** (root config)

### Step 2: packages/shared — Types
```typescript
// types.ts
export interface SymbolRecord {
  id: string
  name: string
  kind: "class" | "function" | "method" | "enum" | "constant"
  filePath: string       // relative to Cesium source root
  startLine: number
  endLine: number
  docComment?: string
  exports: string[]      // exported names
  imports: string[]      // imported module paths
  parentClass?: string   // for methods: owning class name
}
```

### Step 3: packages/parser — Symbol Extractor
Use **ts-morph** to parse `.js` files and extract symbols.

**`symbol-extractor.ts`** core logic:
1. Create `Project` with `allowJs: true`
2. For each `.js` file, iterate source files
3. **Class detection**:
   - Check `ClassDeclaration` → kind = "class"
   - Check `FunctionDeclaration` with `@alias` JSDoc tag → kind = "class"
4. **Method detection**:
   - `MethodDeclaration` inside class → kind = "method", parentClass = class name
   - `PropertyAccessExpression` pattern `X.prototype.y = function` → kind = "method"
5. **Function detection**: `FunctionDeclaration` without `@alias` → kind = "function"
6. **Enum detection**: `VariableDeclaration` with `@enum` JSDoc → kind = "enum"
7. **Constant detection**: exported `VariableDeclaration` with `@constant` or simple exported const → kind = "constant"
8. **Imports**: collect all `ImportDeclaration` module specifiers
9. **Exports**: collect all `ExportDeclaration` and `export default` names
10. **JSDoc**: extract `getJsDocs()` text for each symbol

**Output**: `SymbolRecord[]` per file

### Step 4: packages/storage — SQLite Layer
Use **better-sqlite3**.

**`schema.ts`**:
```sql
CREATE TABLE IF NOT EXISTS symbols (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  doc_comment TEXT,
  exports TEXT,          -- JSON array
  imports TEXT,          -- JSON array
  parent_class TEXT
);

CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts
  USING fts5(name, doc_comment, content=symbols, content_rowid=rowid);
```

**`symbol-repo.ts`**: `insertMany(symbols)`, `findByName(name)`, `searchFts(query, limit)`, `countByKind()`

### Step 5: packages/indexer — Cesium Source Scanner
**`cesium-source.ts`**:
1. Accept `cesiumRoot` path (default from config or CLI argument)
2. Glob `packages/engine/Source/**/*.js` + `packages/widgets/Source/**/*.js`
3. Exclude: `**/ThirdParty/**`, `**/Shaders/**`, `**/Workers/**`, `**/Specs/**`, `**/Assets/**`
4. For each file → call `symbol-extractor.extract(filePath)`
5. Collect all `SymbolRecord[]`, assign stable IDs (hash of `filePath:name:kind`)
6. Insert into SQLite via `symbol-repo.insertMany()`
7. Print summary: total files, total symbols, breakdown by kind

### Step 6: packages/cli — Commander Entry
**`index.ts`**: Commander program with `index:symbols` sub-command
**`commands/index-cmd.ts`**:
```bash
cesium index:symbols [cesium-root]
  --cesium-root <path>   Path to Cesium source directory
  --db <path>            SQLite database path (default: ./database/cesium.db)
  --verbose              Show per-file progress
```
Flow: parse args → init storage → run indexer → print results

### Step 7: Tests (vitest)
- **parser/symbol-extractor.test.ts**: Test extraction against real Cesium files:
  - `Camera.js` → function constructor class with methods
  - `Intersect.js` → enum
  - `defined.js` → standalone function
  - Verify: name, kind, filePath, startLine, docComment, imports
- **storage/symbol-repo.test.ts**: CRUD operations, FTS5 search
- **indexer/cesium-source.test.ts**: Integration test with subset of files

### Step 8: Acceptance Verification
```bash
# Run against submodule (default path)
cesium index:symbols

# Or specify a different Cesium source path
cesium index:symbols --cesium-root /path/to/cesium

# Verify acceptance criteria
# 1. Viewer indexed (packages/widgets/Source/Viewer/Viewer.js)
# 2. Scene indexed (packages/engine/Source/Scene/Scene.js)
# 3. Camera indexed (packages/engine/Source/Scene/Camera.js)

# Check counts
# Expected: 1000+ symbols across multiple kinds
```

## Dependencies to Install
```
devDependencies:
  typescript, tsup, vitest, @types/node, @types/better-sqlite3

dependencies (workspace):
  ts-morph, better-sqlite3, commander, glob (tinyglobby)
```

## Risk Mitigation
- **Prototype chain parsing**: Cesium has both old and new patterns; test with Camera.js (old) and newer class files
- **Large file handling**: Scene.js is ~4000 lines; ts-morph handles this fine
- **ID stability**: Use `crypto.createHash('md5').update(filePath + ':' + name + ':' + kind)` for deterministic IDs
- **FTS5 availability**: better-sqlite3 bundles FTS5 by default on Windows

## File Count Estimate
~20 new files across 7 packages + root config files
