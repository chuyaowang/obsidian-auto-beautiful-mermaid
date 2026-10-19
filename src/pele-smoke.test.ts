/**
 * Pele's real output, not a mock: verifies the SVGs it emits for each diagram
 * family survive {@link appendSvg}'s XML-then-HTML parse and land in the DOM.
 */
import { describe, expect, it } from "vitest";
import { render } from "pele";
import { appendSvg } from "./main";

describe("real pele output", () => {
  it.each([
    "flowchart LR\n  A[开始<br>处理] --> B{判断}\n  B -->|是| C[(库)]",
    "sequenceDiagram\n  A->>B: hi",
    "classDiagram\n  class A {\n    +String name\n  }",
    "erDiagram\n  A ||--o{ B : has",
    "stateDiagram-v2\n  [*] --> A",
    "xychart-beta\n  bar [1, 2]",
    "gantt\n  title T\n  dateFormat YYYY-MM-DD\n  section S\n  t :a1, 2024-01-01, 3d",
    "pie title P\n  \"A\": 1",
    "mindmap\n  root\n    child",
  ])("appendSvg accepts pele output for %j", (source) => {
    const host = document.createElement("div");
    appendSvg(host, render(source).svg);
    expect(host.querySelector("svg")).not.toBeNull();
  });

  it("escapes label text instead of emitting it as markup", () => {
    const host = document.createElement("div");
    appendSvg(host, render("flowchart LR\n  A[<script>x</script>] --> B").svg);
    expect(host.querySelector("script")).toBeNull();
  });
});
