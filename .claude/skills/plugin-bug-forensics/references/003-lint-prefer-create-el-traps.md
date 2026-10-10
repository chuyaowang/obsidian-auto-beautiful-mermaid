# 档案 #003 — lint 接入:prefer-create-el 三连陷阱

**确认日期**: 2026-10-10 · **修复 commit**: `34c2451` · **发版**: v1.0.5

## 表象

- 官方市场 bot 两次留言 `obsidianmd/prefer-create-el` 警告(2026-06、2026-10),每改一次又被警告一次
- **警告本身无运行时错误**——两版被警告代码都工作正常(用户已验证功能)
- 本地从未装官方 lint:两条警告都来自市场侧 CI

## 根因

本地与市场 CI 规则集不同步。且规则的 autofix 建议(`doc.createDiv()`)在本项目场景是**错的**——见下。

## 实证的三个坑(Chromium 验证 + 解包 enhance.js)

1. **`document.appendChild(<div>)` 直接抛错**(DOM 规范:document 只能有一个根元素)。规则推荐 `doc.createElement("div") → doc.createDiv()`,而 enhance.js 里 `Node.prototype.createDiv` = `createEl({parent: this})` → 挂到 document → 对 CodeMirror `WidgetType.toDOM()` 需要的**游离元素**场景是 crash。官方规则被 `eslint-comments/no-restricted-disable` 保护,**禁止行级 disable**——不许不照它写,而它说的又是错的。
2. **`createEl`/`createDiv`/`activeDocument` 是 ambient 全局**(obsidian.d.ts `declare global`),不是模块导出,不能 `import { createEl } from "obsidian"`(tsc 报 no-exported-member)。运行时由 enhance.js 注入每个窗口——所有窗口(含 popout)都 `loadURL` 同一个 `index.html`,已实证。
3. enhance.js 语义:`window.createEl(tag, info)` 无 `info.parent` 时**只创建不挂载**;`this.appendChild` 在 strict mode 全局调用下 `this === undefined`。

## 修复

- **游离元素**(widget host 场景):裸全局 `createDiv()`——无 this、无 parent → 不挂载,规则零警告
- **挂载语义**:`element.createDiv()`(原型方法,parent=this)
- `test/setup.ts` polyfill:`HTMLElement.prototype`(挂载)+ `globalThis`(createEl/createDiv/activeDocument,游离);工厂签名 `this: HTMLElement | undefined` + `this?.appendChild`
- `test/**` 关闭 `prefer-create-el` 与 `no-global-this`(测试建游离 host、polyfill 定义全局,均语义正确;官方 bot 只 lint src/)
- lint CI(`.github/workflows/lint.yml`):push/PR 跑 `npm run lint`,先于市场 bot

## 禁止事项

- **永远不要在本项目写 `document.createDiv()` / `doc.createDiv()`**——生产 crash
- 不要对 `obsidianmd/prefer-create-el` 行级 disable(被 no-restricted-disable 拒绝)
- 不要 `--fix` 盲收——此规则 autofix 有已知错误建议,必须人工核对语义
- 不要删 `tsconfig.json` 里 test/构建配置的 include(lint 的 type-checked 规则需要)

## 治理教训

接到 lint 警告:先判"警告是否伴随真实错误"(跑测试 + 语义分析),再决定修法;**规则的建议本身也要取证——权威不等于正确**。本次修法绕了三步(doc.createElement → doc.createDiv 会炸 → 全局 createDiv),每步被规则或运行时否决一次,若第一轮就解包 enhance.js 看运行时语义,可省两轮。
