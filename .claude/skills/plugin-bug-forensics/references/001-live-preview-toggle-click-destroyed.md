# 档案 #001 — Live Preview 点击工具栏失效

**确认日期**: 2026-10-09 · **修复 commit**: `0af4295` · **发版**: v1.0.4

## 表象

- Reading View 一切正常
- Live Preview 里点 Beautiful/System/Both 按钮:视图闪回旧模式,像"显示源码"
- 用户最初怀疑 Obsidian 1.14 自动更新(10-06 从 1.13.7 升级,时间线吻合)——**已排除**

## 根因

`MermaidEditorWidget.ignoreEvent()` 返回 `false` → 按钮 mousedown 穿透 CodeMirror → 光标落入 fence → `selectionIntersects` 命中 → 装饰重建 → **widget(连同按钮)在 click 触发前被销毁** → `setMode` 从未执行 → 光标移走后 widget 重建,读回旧模式。

Reading View 无光标概念,所以不受影响——这就是"一个表面正常一个表面坏"的二分信号。

## 修复(两层防御,缺一不可)

1. 工具栏按钮 `mousedown` → `event.preventDefault()`(阻止光标进入 fence)
2. `ignoreEvent(event)` 对 `target.closest(".abm-toolbar") != null` 的事件返回 `true`

## 验证方法

- Live Preview 点四个按钮应即时切换、不弹回
- 回归测试:`src/main.test.ts` 的 mousedown preventDefault 测试与模式切换测试

## 禁止事项

- 不要为了"让光标能点进图区"把 `ignoreEvent` 改回无条件 `false`

## 诊断教训

本次绕了远路:解包 1.13.7/1.14.4 asar 全量对比、Chromium 实测两版本引擎渲染(结论:引擎字节级一致,更新无辜)。**应先问用户"哪个视图、哪个模式"再怀疑外部环境**——一个二分问题就能省掉整轮 asar 取证。
