# Diagnosis KB Mining — W4 审核包

> 生成时间：2026-06-24T21:20:00+08:00
> 审核人：Hermes Agent (自动化)
> 数据源：cesium-nexus database/cesium.db + Qdrant eng-knowledge

---

## 1. 当前 Knowledge Base 概况

```yaml
problem_patterns:
  total: 10
  categories:
    rendering:  3   # z_fighting, depth_precision, shader_compile_error
    terrain:    1   # terrain_conflict
    tiles:      2   # tiles_jitter, tiles_loading
    performance: 2  # primitive_performance, lod_popping
    debug:      2   # label_visibility, picking_failure

coverage:
  total_issues: 338
  covered_issues: 132
  coverage_percent: 39.05%

kb_version: v0.5.0 (Phase 2D, tag e04a5ea)
```

### 各 Pattern 命中统计（Phase 2D 基线）

| Pattern | Hits | Category |
|---------|------|----------|
| tiles_jitter | 69 | tiles |
| shader_compile_error | 32 | shader |
| terrain_conflict | 30 | terrain |
| label_visibility | 26 | debug |
| primitive_performance | 23 | performance |
| picking_failure | 19 | debug |
| tiles_loading | 13 | tiles |
| lod_popping | 8 | performance |
| z_fighting | 5 | rendering |
| depth_precision | 5 | rendering |

---

## 2. Candidate 生成配置

```yaml
mining_config:
  threshold: 0.85
  min_cluster_size: 2
  embedding_model: Xenova/all-MiniLM-L6-v2 (384 维)
  clustering_algorithm: CosineThresholdClusterer (greedy seed)
  merge_strategy: buildCanonicalProblems (1:1 cluster→canonical)
```

### 含义说明

- **threshold=0.85**：两个 issue 向量的 cosine similarity ≥ 0.85 才会被归入同一 cluster。0.85 是宽松档（三档：0.85/0.90/0.95），允许更多聚类。
- **cluster 形成规则**：greedy seed 算法。每个 seed 吸纳所有 pairwise cosine ≥ threshold 的成员。minClusterSize=2 过滤掉孤立点。
- **candidate 生成规则**：每个 cluster → 一个 CanonicalProblem → LLM 草拟一个 PatternCandidate。LLM 返回 JSON（aliases/symptoms/symbols/category），失败则标记 `failedDraft=true`。
- **阈值选择理由**：0.90 仅产出 3 个 cluster（太严格），0.85 产出 4 个 cluster，所有 draft 均成功。

---

## 3. Candidate 详细信息

### Candidate 1

```yaml
id: candidate/1
category: rendering
cluster: cluster/1
cluster_size: 2
cosine_score: 1.000 (完全重复)

source_issues:
  - number: 13573
    title: "Handle skirt visibility with terrain-like 3D Tiles"
    state: open
  - number: 13573  # 注意：同一 issue 出现两次（Qdrant 去重问题）
    title: "Handle skirt visibility with terrain-like 3D Tiles"
    state: open

aliases:
  - 3d-tiles-skirt-visibility
  - skirt-rendering-artifact
  - terrain-skirt-clipping
  - tileset-skirt-z-fighting

symptoms:
  - Skirts of 3D Tiles appear visible when they should be clipped by terrain
  - Visual artifacts where tile skirts intersect incorrectly with terrain geometry
  - Skirts remain visible even when terrain occlusion is enabled

symbols:
  - Tileset
  - 3DTileContent
  - TerrainProvider
  - Scene
  - FrustumGeometry

root_cause_hypothesis: |
  3D Tiles 的 skirt 几何体（用于消除瓦片接缝的延伸面）在 terrain-like 模式下
  未正确被地形裁剪。可能是裁剪平面计算或 skirt 深度偏移问题。

proposed_fix: |
  需要在 Cesium3DTileContent 渲染阶段增加 terrain 裁剪判断，或调整 skirt
  的深度偏移量使其被地形正确遮挡。
```

### Candidate 2

```yaml
id: candidate/2
category: rendering
cluster: cluster/2
cluster_size: 2
cosine_score: 0.996

source_issues:
  - number: 13183
    title: "Billboards at Same Coordinate with CLAMP_TO_GROUND Do Not Maintain Consistent Draw Order / Z-Index"
    state: closed
  - number: 13182
    title: "Billboards at Same Coordinate with CLAMP_TO_GROUND Do Not Maintain Consistent Draw Order / Z-Index"
    state: closed

aliases:
  - billboard-z-index-clamp-to-ground
  - billboard-draw-order-depth-issue
  - clamped-billboard-overlap
  - billboard-rendering-order

symptoms:
  - Billboards at the same location do not render in the expected order
  - Z-index is ignored when billboards are clamped to ground
  - Overlapping billboards flicker or swap visibility unexpectedly

symbols:
  - BillboardCollection
  - Billboard
  - ClampMode
  - Scene
  - Primitive

root_cause_hypothesis: |
  CLAMP_TO_GROUND 模式下，Billboard 的深度值由地形决定而非用户指定的 z-index。
  当多个 Billboard 位于同一坐标时，深度值完全相同导致渲染顺序不确定（GPU
  depth test 的浮点精度问题）。

proposed_fix: |
  在 Billboard shader 中引入 z-index 作为 secondary sort key，或在
  CLAMP_TO_GROUND 模式下为每个 Billboard 添加微小深度偏移。
```

### Candidate 3

```yaml
id: candidate/3
category: rendering
cluster: cluster/3
cluster_size: 2
cosine_score: 0.851

source_issues:
  - number: 12892
    title: "Create reference implementation for proposed glTF extension EXT_textureInfo_constant_lod"
    state: closed
  - number: 12891
    title: "Create reference implementation for proposed glTF extension BENTLEY_materials_point_style"
    state: closed

aliases:
  - gltf-extension-implementation
  - glTF-extension-reference
  - bentley-materials-point-style
  - texture-info-constant-lod

symptoms:
  - Need for reference implementations of proposed glTF extensions
  - Lack of support for EXT_textureInfo_constant_lod in Cesium
  - Lack of support for BENTLEY_materials_point_style in Cesium

symbols:
  - Model
  - GltfPipeline
  - Material
  - TextureInfo

root_cause_hypothesis: |
  Cesium 的 glTF 加载管线不支持非标准扩展。BENTLEY_materials_point_style
  和 EXT_textureInfo_constant_lod 是提议中的扩展，需要在 GltfPipeline 中
  解析扩展 JSON 并生成对应的 Material/Texture 状态。

proposed_fix: |
  在 GltfPipeline 的 material 解析阶段增加 extension handler，将扩展属性
  映射到 Cesium 的 Material 系统。需要配合 glTF spec 提案进度。
```

### Candidate 4

```yaml
id: candidate/4
category: rendering
cluster: cluster/4
cluster_size: 2
cosine_score: 0.905

source_issues:
  - number: 12890
    title: "Create reference implementation for proposed glTF extension BENTLEY_materials_planar_fill"
    state: open
  - number: 12889
    title: "Create reference implementation for proposed glTF extension BENTLEY_materials_line_style"
    state: closed

aliases:
  - gltf-extension-implementation
  - bentley-materials-planar-fill
  - bentley-materials-line-style
  - custom-gltf-rendering
  - glTF-extension-support

symptoms:
  - Users require reference implementations for custom glTF extensions
  - Need support for Bentley-specific material properties like planar fill
  - Need support for Bentley-specific line styles in glTF assets
  - Difficulty implementing non-standard glTF extensions in Cesium

symbols:
  - Model
  - ModelAnimation
  - GltfPipeline
  - Material
  - ShaderProgram
  - Texture
  - VertexAttribute

root_cause_hypothesis: |
  与 Candidate 3 同源——Bentley 的 glTF 扩展系列。BENTLEY_materials_planar_fill
  控制平面填充样式，BENTLEY_materials_line_style 控制线样式。需要自定义
  Shader 和 Material 管线。

proposed_fix: |
  同 Candidate 3，需要在 GltfPipeline 中增加 extension handler。planar_fill
  需要自定义 fragment shader，line_style 需要 geometry shader 或 line width
  控制。
```

---

## 4. 与现有 KB 的重叠分析

### Candidate 1 → 现有 Pattern

```
nearest_existing_patterns:
  - pattern_id: lod_popping
    similarity: 0.4042
  - pattern_id: tiles_jitter
    similarity: 0.3306
  - pattern_id: depth_precision
    similarity: 0.3125
  - pattern_id: terrain_conflict
    similarity: 0.3085

duplicate_risk: LOW
merge_candidate: NO
reason: |
  最高相似度 0.404（lod_popping），远低于 0.9 去重阈值。
  skirt visibility 是独立问题，与现有 pattern 无语义重叠。
  可能与 terrain_conflict 有部分症状重叠（地形相关），但根因不同。
```

### Candidate 2 → 现有 Pattern

```
nearest_existing_patterns:
  - pattern_id: terrain_conflict
    similarity: 0.3039
  - pattern_id: z_fighting
    similarity: 0.2542
  - pattern_id: lod_popping
    similarity: 0.2168

duplicate_risk: LOW
merge_candidate: NO
reason: |
  最高相似度 0.304（terrain_conflict）。Billboard draw order 是独立的
  渲染排序问题，与 z_fighting（多边形闪烁）不同。
  label_visibility 可能有部分症状相似（可见性问题），但根因完全不同。
```

### Candidate 3 → 现有 Pattern

```
nearest_existing_patterns:
  - pattern_id: shader_compile_error
    similarity: 0.2482
  - pattern_id: label_visibility
    similarity: 0.1612
  - pattern_id: lod_popping
    similarity: 0.1303

duplicate_risk: LOW
merge_candidate: NO
reason: |
  最高相似度 0.248（shader_compile_error）。glTF 扩展实现是功能缺失，
  不是 shader 编译错误。与现有 pattern 无重叠。
```

### Candidate 4 → 现有 Pattern

```
nearest_existing_patterns:
  - pattern_id: shader_compile_error
    similarity: 0.2424
  - pattern_id: label_visibility
    similarity: 0.1062
  - pattern_id: primitive_performance
    similarity: 0.0847

duplicate_risk: LOW
merge_candidate: YES (与 Candidate 3 合并)
reason: |
  与 Candidate 3 来源相同（Bentley glTF 扩展系列），aliases 重叠
  （gltf-extension-implementation）。建议合并为一个 pattern
  "gltf-extension-support" 覆盖所有 Bentley 扩展。
```

---

## 5. Coverage 影响预测

```yaml
before:
  covered: 132
  total: 338
  percent: 39.05%

after_promote:
  covered: ~134-138
  total: 338
  percent: ~39.6%-40.8%

coverage_gain: ~0.6-1.8pp
```

### 预测说明

**注意：当前 Coverage 提升远低于 15pp 目标。** 原因分析：

1. **数据量不足**：338 条 issue 中，仅 4 个 cluster（每 cluster 2 条 issue），新增覆盖最多 8 条 issue
2. **Cluster 太小**：min-cluster=2 仅产出 2-issue clusters，覆盖率提升有限
3. **Candidates 数量不足**：计划目标 ≥5 个 accepted，当前仅 4 个（1 个需要 merge）
4. **现有 KB 覆盖率已较高**：39.05% 的基线说明 Phase 2D 的 10 个 pattern 已覆盖大部分高频问题

### 新增覆盖的 Issue（预测）

- #13573: Handle skirt visibility with terrain-like 3D Tiles（candidate/1）
- #13183: Billboards at Same Coordinate with CLAMP_TO_GROUND...（candidate/2）
- #13182: Billboards at Same Coordinate with CLAMP_TO_GROUND...（candidate/2）
- #12892: Create reference implementation for EXT_textureInfo_constant_lod（candidate/3）
- #12891: Create reference implementation for BENTLEY_materials_point_style（candidate/3）
- #12890: Create reference implementation for BENTLEY_materials_planar_fill（candidate/4）
- #12889: Create reference implementation for BENTLEY_materials_line_style（candidate/4）

---

## 6. Candidate 质量评分

### 评分标准

| 维度 | 含义 | 范围 |
|------|------|------|
| evidence_score | 源 issue 数量与质量 | 0-100 |
| cohesion_score | cluster 内成员一致性 | 0-100 |
| uniqueness_score | 与现有 KB 的差异度 | 0-100 |
| coverage_gain_score | 预期覆盖率提升贡献 | 0-100 |
| overall_score | 加权总分 | 0-100 |

### Candidate 1

```yaml
evidence_score:    15/100  # 仅 1 个独立 issue（Qdrant 去重后）
cohesion_score:     0/100  # cluster 内成员完全重复（同一 issue）
uniqueness_score:  85/100  # 与现有 KB 无重叠
coverage_gain_score: 10/100  # 仅覆盖 1 条新 issue
overall_score:     28/100

扣分原因:
  - cluster 内 2 个成员实际是同一 issue #13573 的重复向量
  - 证据严重不足（单例 cluster）
  - 无法判断问题的普遍性
```

### Candidate 2

```yaml
evidence_score:    30/100  # 2 个 issue（但标题完全相同，可能是重复 issue）
cohesion_score:    95/100  # cosine=0.996，高度一致
uniqueness_score:  90/100  # Billboard draw order 与现有 KB 无重叠
coverage_gain_score: 15/100  # 覆盖 2 条新 issue
overall_score:     58/100

扣分原因:
  - 2 个 issue 标题完全相同（#13182 和 #13183），可能是重复提交
  - 证据基础薄弱
  - 但问题描述明确，Billboard CLAMP_TO_GROUND 排序是真实问题
```

### Candidate 3

```yaml
evidence_score:    25/100  # 2 个 issue（不同扩展，但同类需求）
cohesion_score:    85/100  # cosine=0.851，中等一致性
uniqueness_score:  95/100  # glTF 扩展实现与现有 KB 完全不同
coverage_gain_score: 20/100  # 覆盖 2 条新 issue
overall_score:     56/100

扣分原因:
  - 2 个 issue 属于同一类需求（Bentley glTF 扩展），但涉及不同扩展
  - 这是"功能请求"而非"问题诊断"，与 Diagnosis System 的定位不完全匹配
  - 但可作为"glTF 扩展支持"类问题的 pattern
```

### Candidate 4

```yaml
evidence_score:    25/100  # 2 个 issue（同 Candidate 3 的同类需求）
cohesion_score:    90/100  # cosine=0.905，高度一致
uniqueness_score:  60/100  # 与 Candidate 3 高度重叠（应合并）
coverage_gain_score: 5/100   # 合并后不增加额外覆盖
overall_score:     45/100

扣分原因:
  - 与 Candidate 3 高度重叠，aliases 共享 "gltf-extension-implementation"
  - 合并后不增加额外覆盖
  - 同样是"功能请求"而非"问题诊断"
```

---

## 7. 审核请求

### Questions

1. **Candidate 3 与 Candidate 4 是否应合并？**
   - 建议：**是**。两者来源相同（Bentley glTF 扩展系列），aliases 重叠。
   - 合并后 pattern ID 建议为 `gltf-extension-support`，覆盖所有 Bentley 扩展。
   - 合并后 aliases: `gltf-extension-implementation, bentley-materials-point-style, bentley-materials-planar-fill, bentley-materials-line-style, EXT_textureInfo_constant_lod, custom-gltf-rendering`

2. **哪些 candidate 应 approve？**
   - 建议 approve: **candidate/2**（Billboard draw order）— 问题明确，与现有 KB 无重叠
   - 建议 approve: **candidate/3+4 合并体**（glTF extension support）— 覆盖新领域
   - 建议 reject: **candidate/1**（skirt visibility）— 单例 cluster，证据不足

3. **哪些 candidate 应 reject？**
   - 建议 reject: **candidate/1** — Qdrant 去重失败导致同一 issue 重复，实际只有 1 个 source issue，无法验证问题模式的普遍性

4. **当前是否值得再跑一轮 mining？**
   - **是**，但需要调整参数。当前 4 个 candidate 中仅 2-3 个有效（合并后），远低于 15pp Coverage 提升目标。
   - 主要瓶颈：338 条 issue 中 cosine ≥ 0.85 的 cluster 太少。需要更多 issue 数据或更低的 threshold。

5. **如果重跑，推荐参数是什么？**
   - **方案 A**（增加数据量）：`sync:issues --since 2025-06-01`（拉 1 年数据），`pkb embed:issues`，然后 `pkb mine --threshold 0.85 --min-cluster 2`
   - **方案 B**（降低阈值）：`pkb mine --threshold 0.80 --min-cluster 2`，但可能引入更多噪声
   - **方案 C**（混合）：先拉更多数据（方案 A），再用 threshold=0.85 挖掘
   - 推荐 **方案 A**，因为数据量是主要瓶颈

---

## 附录 A: 修复记录（W4 执行过程中）

| 问题 | 根因 | 修复 |
|------|------|------|
| `better-sqlite3` ESM require 错误 | tsup 打包未 externalize native 模块 | mining/storage/cli tsup.config.ts 添加 `external: ["better-sqlite3"]` |
| Qdrant 向量查询返回 0 条 | `nodeType` vs `node_type` 字段名不匹配 + `cesium-issue` vs `github-issue` 值不匹配 | 修复 qdrant-embedding-provider.ts 字段名和值 |
| `since` 过滤器失效 | `created_at` 存储为 ISO 字符串，range filter 期望数字 | 临时禁用 since 过滤（数据已全量同步） |
| LLM HTTP 404 `/v1/v1/chat/completions` | baseUrl 已含 `/v1`，代码又拼了一次 | llm-backend.ts 添加 `.replace(/\/v1$/, "")` |
| sharp 原生模块未编译 | pnpm 跳过 build scripts | `pnpm install --force` 触发编译 |
| HuggingFace 模型下载失败 | 国内无法直连 huggingface.co | 设置 `HF_ENDPOINT=https://hf-mirror.com` |

## 附录 B: W4 硬指标对照

| 指标 | 目标 | 当前 | 达标 |
|------|------|------|------|
| Approved Rate ≥ 20% | ≥20% | 待人工审核（预期 50-75%） | 待定 |
| FP Rate ≤ 50% | ≤50% | 待人工复查 | 待定 |
| Coverage 提升 ≥ 15pp | ≥15pp | ~0.6-1.8pp | ❌ |
| Accepted 绝对数 ≥ 5 | ≥5 | 2-3（合并后） | ❌ |
| CanonicalProblem 去重 ≥ 70% | ≥70% | 需人工抽样 | 待定 |
| 回归测试 ≥ 15 个 | ≥15 | 374（全量） | ✅ |
| 性能 < 60s | <60s | 63s（含 LLM）/ 0.2s（不含 LLM） | ⚠️ |
| 审核文档 | 完成 | 本文档 | ✅ |
