# dsh-plugin-verify 路线图（Roadmap）

> 基线：**v1.0.0**（已发布 npm / 已挂 vertical-toolkits profile）
> 范围：接下来 5 个版本 **v1.1.0 → v1.5.0**
> 规划原则：只读、不执行被校验内容；判定逻辑纯函数可单测；网络探针可离线降级。

## 版本总览

| 版本 | 主题 | 关键交付 |
|---|---|---|
| v1.1.0 | 批量与置信度 | `batch` 批量校验（多 claim/URL/包）+ 置信度分级与汇总表 |
| v1.2.0 | 报告与回归 | 校验报告导出（md/json）+ 历史对比（回归检测） |
| v1.3.0 | 严格校验 | 真 YAML 解析 + JSON Schema 校验 |
| v1.4.0 | 探针增强 | 并发/重试/超时策略 + HTTP 头与证书到期检查 |
| v1.5.0 | 提交就绪扩展 | npm 发布状态、topic、README 完整性、awesome 收录检查 |

## v1.1.0 ✅ 已完成 — 批量与置信度

### 新增能力
- **`batch` 模式**：一次提交多条校验任务（`claims` 多条论断 / `urls` 多个链接 / `packages` 多个 npm 包 / `repos` 多个仓库），并发受限、逐项汇总为一张结果表。
- **置信度分级**：每条结果给出 `confidence`（high / medium / low）与依据条数（命中数、HTTP 状态、注册表字段），并把整体结论收敛为 `verified / partial / unsupported`。

### 实现位置
- `lib/batch.js`（新增）：任务归一化、并发池、汇总与置信度纯函数（网络注入以便测试）
- `lib/index.js`：注册 `batch` 模式与参数

### 验收标准
- [ ] `node --check` 通过；新增单测 ≥ 8 个（任务归一化、并发池、置信度分级、汇总、失败项、边界）
- [ ] 原有 `verify.test.mjs` 全绿
- [ ] README 更新（batch 用法与置信度说明）
- [ ] vertical-toolkits dump-config 正常

## v1.2.0 — 报告与回归

- `report`：导出 Markdown / JSON 校验报告
- 与历史报告对比，标出由通过转失败（回归）的条目

## v1.3.0 — 严格校验

- 引入真 YAML 解析（结构化错误定位）与 JSON Schema 校验（`schema` 参数）

## v1.4.0 — 探针增强

- 并发/重试/超时策略可配；HTTP 头检查（content-type、缓存）、TLS 证书到期提醒

## v1.5.0 — 提交就绪扩展

- 发布就绪检查：npm 是否已发布该版本、topic 是否齐备、README 关键段、awesome 是否收录

## 发布节奏

每个版本走完整 dsh-factory 流程：本地验证 → npm publish → GitHub topic → awesome PR。
