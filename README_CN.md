# Auto Beautiful Mermaid

[English](README.md) | 中文

一款 [Obsidian](https://obsidian.md) 插件，智能路由 Mermaid 图表渲染：

- **[beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid)** 负责渲染它支持的 6 种图表类型（流程图、时序图、状态图、类图、ER 图、XY 图表）—— 输出精美的、适配主题的 SVG。
- **[pele](https://github.com/obsidianmd/pele)**（Obsidian 官方新渲染器）负责它能识别的全部类型（gantt、pie、mindmap、timeline、gitGraph……）—— 同步、零运行时依赖、跟随主题。
- **Obsidian 内置 mermaid 引擎** 兜底其余类型 —— 保留原生交互能力和完整的 Mermaid 类型支持。

可在设置里选择默认渲染器；每个代码块也能单独切换。阅读视图（Reading View）和实时预览（Live Preview）均已覆盖。

## 功能特性

- ✅ 支持的图表类型自动使用 `beautiful-mermaid` 输出精美效果
- ✅ 完整的 Mermaid 类型覆盖 —— 不会有图表因为不支持而报错
- ✅ 新增 Pele 渲染器，覆盖 beautiful-mermaid 画不了的众多类型
- ✅ 设置项选择默认渲染器，每个代码块上方的工具栏可切换 **Beautiful / Pele / System / Both / Source**
- ✅ 自动适配暗色/亮色主题
- ✅ 支持实时预览（CodeMirror EditorExtension）
- ✅ 零冲突 —— 完全接管所有 `mermaid` 代码块，不会出现重复渲染

## 支持的图表类型（Beautiful 模式）

| 类型 | 关键词 |
|------|--------|
| 流程图 | `flowchart` / `graph` |
| 时序图 | `sequenceDiagram` |
| 状态图 | `stateDiagram` / `stateDiagram-v2` |
| 类图 | `classDiagram` |
| ER 图 | `erDiagram` |
| XY 图表 | `xychart-beta` |

Pele 覆盖的类型更多（gantt、pie、mindmap、timeline、journey、gitGraph、quadrant、sankey、block、architecture、kanban、radar、treemap、C4、packet……），只有当它能画该类型时才显示 Pele 按钮。

两个引擎都画不了的类型走 **System 模式**（Obsidian 内置引擎）。

## 安装

### 社区插件商店（推荐）

1. 打开 Obsidian 设置 → 社区插件 → 浏览
2. 搜索 **Auto Beautiful Mermaid**
3. 点击安装，然后启用

### 手动安装

1. 从 [最新 Release](https://github.com/rxdxxxx/obsidian-auto-beautiful-mermaid/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到 `<vault>/.obsidian/plugins/auto-beautiful-mermaid/`
3. 重新加载 Obsidian，在设置 → 社区插件中启用该插件

## 兼容性

- 最低 Obsidian 版本：**1.4.0**
- 与 `beautiful-mermaid-renderer` 插件冲突 —— 如果两者都安装了，请禁用其中一个

## 开发

```bash
npm install
npm run dev      # 监听模式
npm run build    # 生产构建
npm run test     # 单元测试
```

详细架构说明和双重渲染问题根因分析见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 许可证

[MIT](LICENSE)
