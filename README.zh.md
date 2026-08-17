# dsh-plugin-verify（核验工具箱）

为 DeepSeek Harness agent 提供基于证据的核验工具：声明核查、配置文件校验、只读网络探测（URL / npm / GitHub）。

## 工具

| 模式 | 作用 |
|---|---|
| `claim` | 在工作区文件中核查一句声明：提取关键词、统计命中、返回**带行号引用**的证据，判定 verified / partial / unsupported |
| `config` | 校验配置文件：JSON 严格解析 / YAML 结构冒烟检查 |
| `url` | HTTP(S) 可用性：状态码、跳转目标、耗时 |
| `npm` | 注册表核查：是否存在、最新版本、`dsh.bundle` 清单、发布时间 |
| `repo` | GitHub 提交就绪度：存在性、仓库年龄、`dsh-plugin` topic、大致提交数 |

## 使用

```
verify claim "the plugin pins zod in dependencies"
verify config ./cordis.patch.yml
verify url https://example.com
verify npm dsh-plugin-focus
verify repo 863683348/dsh-plugin-gate
```

## 说明

- 只读：不写文件、不执行被扫描内容。
- 声明核查是启发式证据检索，不是证明——unsupported 表示"没找到证据"，应视为未证实。
- YAML 校验为结构冒烟检查（引号/括号配平、缩进），非完整 YAML 解析器。

## 许可证

MIT
