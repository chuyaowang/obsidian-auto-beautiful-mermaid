# Auto Beautiful Mermaid

English | [中文](README_CN.md)

An [Obsidian](https://obsidian.md) plugin that intelligently routes Mermaid diagram rendering:

- **[beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid)** renders the 6 diagram types it supports (flowchart, sequence, state, class, ER, XY chart) — giving you polished, theme-aware SVG output.
- **[pele](https://github.com/obsidianmd/pele)**, Obsidian's own Mermaid renderer, can draw every type it detects (gantt, pie, mindmap, timeline, gitGraph, …) with a fast, dependency-free, theme-aware SVG.
- **Obsidian's built-in mermaid engine** backs everything else — preserving native interactivity and the full Mermaid type catalog.

Pick a default renderer in settings; every block also carries a toolbar to switch renderers per diagram. Both Reading View and Live Preview are covered.

## Features

- ✅ Beautiful output for supported diagram types via `beautiful-mermaid`
- ✅ Pele renderer for every type it supports, including ones beautiful-mermaid cannot draw
- ✅ Full Mermaid type coverage — no diagram ever falls through to an error box
- ✅ Default-renderer setting, plus a per-block toolbar: **Beautiful / Pele / System / Both / Source**
- ✅ Automatic dark/light theme adaptation
- ✅ Live Preview support (CodeMirror EditorExtension)
- ✅ Zero conflicts — completely takes over all `mermaid` fences so no duplicate rendering

## Supported Diagram Types (Beautiful mode)

| Type | Keyword |
|------|---------|
| Flowchart | `flowchart` / `graph` |
| Sequence | `sequenceDiagram` |
| State | `stateDiagram` / `stateDiagram-v2` |
| Class | `classDiagram` |
| ER | `erDiagram` |
| XY Chart | `xychart-beta` |

Pele covers a much wider catalog (gantt, pie, mindmap, timeline, journey, gitGraph, quadrant, sankey, block, architecture, kanban, radar, treemap, C4, packet, …). Its button appears only for types it can draw.

Anything neither engine can draw defaults to **System mode** (Obsidian's built-in engine).

## Installation

### Community Plugin Store (recommended)

1. Open Obsidian Settings → Community Plugins → Browse
2. Search for **Auto Beautiful Mermaid**
3. Click Install, then Enable

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/rxdxxxx/obsidian-auto-beautiful-mermaid/releases/latest)
2. Copy them to `<vault>/.obsidian/plugins/auto-beautiful-mermaid/`
3. Reload Obsidian and enable the plugin in Settings → Community Plugins

## Compatibility

- Minimum Obsidian version: **1.4.0**
- Conflicts with `beautiful-mermaid-renderer` — disable that plugin if both are installed

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production build
npm run test     # unit tests
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for architecture details and the double-render root cause analysis.

## License

[MIT](LICENSE)
