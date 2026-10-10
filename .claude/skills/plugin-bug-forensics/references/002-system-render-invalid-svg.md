# 档案 #002 — System 渲染报 "invalid SVG"

**确认日期**: 2026-10-09 · **修复 commit**: `b80b0dd` · **发版**: v1.0.4

## 表象

- 切 System/Both 出红边错误框:
  - 标题 `Auto Beautiful Mermaid — system failed to render this diagram`
  - 消息 `Mermaid renderer returned invalid SVG`
- Beautiful 模式不受影响(走 beautiful-mermaid 自带渲染器,不经过此解析)
- Obsidian 原生渲染不受影响(走 innerHTML,HTML 解析器容忍)
- 用户最初看到的"显示源码"其实是这个错误框——错误框里带源码 `<pre>`

## 根因

mermaid 11 对多行 label(如 `A<br/>B`)在 `<foreignObject>` 里输出 **HTML 片段**:`<br>` 不带 XML 自闭合斜杠、外层包 `<p>`。`appendSvg` 用严格 `image/svg+xml` 解析 → `Unexpected closing tag: p != br` → 抛错。

**波及面**:用户 vault 全量 206 个真实 fence 中 **86 个中招**——多行中文 label 是重灾区。

## 修复

`appendSvg` 双解析回退:
1. 先严格 `image/svg+xml`(通过且无 `parsererror` → importNode 注入)
2. 失败 → `text/html` 解析器摘出 `<svg>`(HTML 解析器容忍 `<br>`,与 Obsidian 原生行为一致)
3. 两者都失败才抛 invalid SVG

Chromium 全量实测 **204/206** 通过,余 2 个为 mermaid 源码本身语法错误,本就应报错。

## 验证方法

- 切 System 渲染多行 label 的图(如 `Paperclip<br/>66.7K ⭐`)
- **全量回放**:提取 vault 全部 fence(`/tmp` 脚本模式:python 正则抽 ```` ```mermaid ```` 块存 JSON),Playwright + Obsidian 同版本 `/lib/mermaid.min.js`,`mermaid.initialize` 参数必须与 app.js 的 loadMermaid after-hook 一致(`securityLevel:'strict'` + `themeVariables.fontFamily` 等),逐个 render + 走新 appendSvg 逻辑

## 禁止事项

- 不要为绕开解析把 SVG 输出改走 `innerHTML`——丢掉 ownerDocument 绑定,popout 跨文档场景会踩坑
- 手造样例通过 ≠ 修复完成,必须跑真实语料全量回归

## 诊断教训

"invalid SVG" 这条消息是我们自己抛的,第一轮诊断时它误导了对"源码显示"表象的归因。**错误框里的消息文字是最便宜的一手证据**,应该第一轮就要用户读出来,而不是先猜。
