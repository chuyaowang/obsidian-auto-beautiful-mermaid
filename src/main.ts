import {
  App,
  editorLivePreviewField,
  loadMermaid,
  MarkdownPostProcessorContext,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
} from "obsidian";
import { renderMermaidSVG, renderMermaidSVGAsync } from "beautiful-mermaid";
import {
  render as renderPeleSvg,
  supports as peleSupports,
  type RenderOptions,
} from "pele";
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/**
 * Diagram type keywords that beautiful-mermaid fully supports.
 * Every other type is left to Obsidian's built-in mermaid renderer.
 *
 * Compared lowercased against the first token of a code block.
 */
const BEAUTIFUL_SUPPORTED = new Set<string>([
  "graph",
  "flowchart",
  "statediagram",
  "statediagram-v2",
  "sequencediagram",
  "classdiagram",
  "erdiagram",
  "xychart",
  "xychart-beta",
]);

/**
 * Priority for our code block processor. A smaller (more negative) value runs
 * earlier. Obsidian registers all post-processors in one array sorted ascending
 * by sortOrder; the native mermaid renderer is a post-processor with no sortOrder
 * (effective 0). Because the code-block wrapper synchronously replaces the
 * `<pre>` with our element *before* calling our handler, a sortOrder < 0
 * deterministically removes `code.language-mermaid` from the subtree before the
 * native post-processor (0) ever scans for it — in the first pass and in every
 * invalidation-rebuild pass. This ordering, not any post-hoc DOM mutation, is
 * what guarantees we are never double-rendered.
 */
const PROCESSOR_PRIORITY = -200;

/** CSS variables passed to beautiful-mermaid so diagrams follow the Obsidian theme. */
const BEAUTIFUL_OPTIONS = {
  bg: "var(--background-primary)",
  fg: "var(--text-normal)",
  transparent: true,
} as const;

/**
 * Pele renders synchronously and colors itself from CSS variables (see
 * styles.css), so the only render-time option needed is the link allowlist.
 * `obsidian` is added so `click A "obsidian://..."` node links work in a vault;
 * pele already drops `javascript:` and other unsafe schemes.
 */
const PELE_OPTIONS: RenderOptions = {
  linkSchemes: ["http", "https", "mailto", "tel", "obsidian"],
  imageSchemes: ["http", "https"],
};

/** The five ways a single mermaid block can be displayed. */
export type ViewMode = "beautiful" | "pele" | "system" | "both" | "source";

/** Modes that fill a slot with rendered SVG (as opposed to stacked/plain views). */
export type RendererMode = Exclude<ViewMode, "both" | "source">;

/** Renderer a block falls back to when nothing has been chosen. */
export type PreferredRenderer = "beautiful" | "pele" | "system";

/** Mode a freshly-rendered block starts in when nothing is remembered. */
export const DEFAULT_MODE: ViewMode = "beautiful";

/** Default for the "Default renderer" setting. */
export const DEFAULT_PREFERRED_RENDERER: PreferredRenderer = "beautiful";

/** Toggle-bar order, left to right. */
const MODE_ORDER: readonly ViewMode[] = ["beautiful", "pele", "system", "both", "source"];

/** Human labels shown on the toggle buttons. */
const MODE_LABELS: Record<ViewMode, string> = {
  beautiful: "Beautiful",
  pele: "Pele",
  system: "System",
  both: "Both",
  source: "Source",
};

/** Settings-tab labels for each preferred renderer. */
const PREFERRED_LABELS: Record<PreferredRenderer, string> = {
  beautiful: "Beautiful (beautiful-mermaid)",
  pele: "Pele (Obsidian's new renderer)",
  system: "System (built-in Mermaid)",
};

/** Main view offered by each preferred renderer. */
const PREFERRED_MODE: Record<PreferredRenderer, ViewMode> = {
  beautiful: "beautiful",
  pele: "pele",
  system: "system",
};

/** Persisted plugin settings. */
export interface PluginSettings {
  preferredRenderer: PreferredRenderer;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  preferredRenderer: DEFAULT_PREFERRED_RENDERER,
};

export default class AutoBeautifulMermaidPlugin extends Plugin {
  /**
   * Per-block view mode, remembered for the session and keyed by fence source
   * (see {@link modeKey}). Survives Live Preview widget rebuilds and Reading View
   * section re-renders triggered by unrelated edits; reset to Beautiful when the
   * note (and thus the plugin's in-memory map) is reopened.
   *
   * Keying by source means two blocks with byte-identical source in the same note
   * share one entry, so they toggle together — an accepted, rare trade-off (no
   * positional id is available across both render surfaces). See design D5.
   */
  private readonly modeStore = new Map<string, ViewMode>();

  /** Obsidian's built-in mermaid engine, loaded once via {@link loadMermaid}. */
  private mermaidInstance?: Promise<MermaidEngine>;

  /** Monotonic source of unique ids for `mermaid.render` (transient DOM ids). */
  private systemIdCounter = 0;

  /** Persisted settings; see {@link PluginSettings}. */
  settings: PluginSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new AutoBeautifulMermaidSettingTab(this.app, this));

    // Reading View: one processor for the `mermaid` fence language. We take over
    // EVERY mermaid block (no type-based delegation), so Obsidian's native
    // PostProcessor never auto-renders any block — this is what prevents one
    // fence producing multiple diagrams. The diagram type only decides the
    // block's default mode and which toolbar buttons appear.
    this.registerMarkdownCodeBlockProcessor(
      "mermaid",
      (source, el, ctx) => this.handleMermaid(source, el, ctx),
      PROCESSOR_PRIORITY,
    );

    // Live Preview: a CodeMirror extension that replaces every mermaid fence with
    // the same toggleable container while the cursor is outside it.
    this.registerEditorExtension(createMermaidEditorExtension(this));
  }

  /**
   * Current mode for a block: the remembered mode if it is still valid for this
   * diagram type, otherwise the type's default (Beautiful for supported types,
   * System for unsupported ones). Clamping matters because the set of modes a
   * block offers depends on its type (see {@link allowedModes}).
   */
  getMode(source: string): ViewMode {
    const allowed = allowedModes(source);
    const stored = this.modeStore.get(modeKey(source));
    return stored && allowed.includes(stored)
      ? stored
      : defaultModeFor(source, this.settings.preferredRenderer);
  }

  /** Remember a block's chosen mode for the session. */
  setMode(source: string, mode: ViewMode): void {
    this.modeStore.set(modeKey(source), mode);
  }

  /** Read persisted settings, falling back to defaults for unknown values. */
  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<PluginSettings> | null;
    const preferred = stored?.preferredRenderer;
    this.settings = {
      preferredRenderer:
        preferred && preferred in PREFERRED_MODE ? preferred : DEFAULT_PREFERRED_RENDERER,
    };
  }

  /** Persist settings. */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Defaults changed: forget per-block overrides so every open view adopts the
    // new default on its next rebuild instead of keeping the old choice.
    this.modeStore.clear();
    this.refreshViews();
  }

  /**
   * Re-mount every open markdown view. Reading View needs an explicit
   * `previewMode.rerender`; Live Preview rebuilds its decorations because
   * `updateOptions` reconfigures the CodeMirror extensions we registered.
   */
  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as MarkdownView;
      if (view.getMode() === "preview") view.previewMode.rerender(true);
    }
    this.app.workspace.updateOptions();
  }

  /**
   * Reading View entry point for a `mermaid` fence. Every block is owned: mount
   * the toggleable container. The type only selects the default mode and buttons.
   *
   * No re-entry guard is needed: neither renderer goes through Obsidian's markdown
   * pipeline, so this handler is never re-invoked recursively.
   */
  private async handleMermaid(
    source: string,
    el: HTMLElement,
    _ctx: MarkdownPostProcessorContext,
  ): Promise<void> {
    const { ready } = mountMermaidBlock({
      host: el,
      source,
      modes: allowedModes(source),
      getMode: () => this.getMode(source),
      setMode: (mode) => this.setMode(source, mode),
      renderers: this.renderersFor(source, /* sync */ false),
    });

    await ready;
  }

  /** Renderer callbacks for the modes a block can offer. */
  private renderersFor(
    source: string,
    sync: boolean,
  ): Partial<Record<RendererMode, (slot: HTMLElement) => void | Promise<void>>> {
    return {
      beautiful: (slot) =>
        sync ? this.renderBeautifulSyncInto(slot, source) : this.renderBeautifulInto(slot, source),
      pele: (slot) => this.renderPeleInto(slot, source),
      system: (slot) => this.renderSystemInto(slot, source),
    };
  }

  /**
   * Render a single fence into a Live Preview widget host.
   *
   * The beautiful path is synchronous here (`renderMermaidSVG`) because a
   * WidgetType's `toDOM()` must return immediately; the System slot still renders
   * asynchronously (via {@link loadMermaid}) and fills in when ready.
   */
  renderWidget(source: string): HTMLElement {
    // CodeMirror hands toDOM() no parent and inserts the return value itself,
    // so the host must be created DETACHED. The ambient global createDiv()
    // (enhance.js: window.createDiv → createEl("div") with no parent) leaves
    // the element unattached — unlike doc.createDiv(), whose parent=this
    // would throw once the document has a root element.
    const host = createDiv();
    mountMermaidBlock({
      host,
      source,
      modes: allowedModes(source),
      getMode: () => this.getMode(source),
      setMode: (mode) => this.setMode(source, mode),
      renderers: this.renderersFor(source, /* sync */ true),
    });
    return host;
  }

  /** Beautiful render for Reading View (async). Errors render in-slot, no fallback. */
  private async renderBeautifulInto(slot: HTMLElement, source: string): Promise<void> {
    try {
      appendBeautiful(slot, await renderMermaidSVGAsync(source, { ...BEAUTIFUL_OPTIONS }));
    } catch (error) {
      renderError(slot, "beautiful-mermaid", error, source);
    }
  }

  /** Beautiful render for Live Preview (synchronous). */
  private renderBeautifulSyncInto(slot: HTMLElement, source: string): void {
    try {
      appendBeautiful(slot, renderMermaidSVG(source, { ...BEAUTIFUL_OPTIONS }));
    } catch (error) {
      renderError(slot, "beautiful-mermaid", error, source);
    }
  }

  /**
   * Pele render, used by both surfaces: `render` is synchronous and DOM-free, so
   * Reading View does not need the async wrapper beautiful-mermaid requires.
   */
  private renderPeleInto(slot: HTMLElement, source: string): void {
    try {
      const { svg } = renderPeleSvg(source, { ...PELE_OPTIONS });
      appendPele(slot, svg);
    } catch (error) {
      renderError(slot, "pele", error, source);
    }
  }

  /**
   * Load Obsidian's built-in mermaid engine once and cache the promise. If the
   * load rejects we clear the cache so a later render retries — caching a rejected
   * promise would otherwise poison every future System render for the session.
   */
  private loadMermaidEngine(): Promise<MermaidEngine> {
    if (!this.mermaidInstance) {
      this.mermaidInstance = Promise.resolve(loadMermaid()).then(
        (engine) => engine as MermaidEngine,
        (error) => {
          this.mermaidInstance = undefined;
          throw error;
        },
      );
    }
    return this.mermaidInstance;
  }

  /**
   * Render the System view with Obsidian's own mermaid engine and inject the SVG
   * directly. Crucially this never emits a `code.language-mermaid` node, so
   * Obsidian's section-level mermaid PostProcessor has nothing to scan and cannot
   * draw a second diagram (the no-double-render invariant). On failure (e.g. a
   * syntax error) show our error box, like the Beautiful path.
   */
  private async renderSystemInto(slot: HTMLElement, source: string): Promise<void> {
    try {
      const mermaid = await this.loadMermaidEngine();
      const id = `abm-sys-${this.systemIdCounter++}`;
      const result = await mermaid.render(id, source);
      const svg = typeof result === "string" ? result : result?.svg;
      if (!svg) throw new Error("mermaid.render returned no SVG");
      appendSvg(slot, svg);
    } catch (error) {
      renderError(slot, "system", error, source);
    }
  }
}

/** The subset of Obsidian's built-in mermaid engine we use. */
interface MermaidEngine {
  render(id: string, source: string): Promise<{ svg?: string } | string>;
}

/**
 * Mount a toggleable mermaid block into `host`.
 *
 * Builds a toolbar of the buttons in `opts.modes` above the view slots. Only the
 * reachable slots are created: the Beautiful slot exists (and renders eagerly)
 * only when `beautiful`/`both` is offered — so an unsupported type, whose modes
 * are `[system, source]`, never invokes `renderBeautiful` and never produces a
 * wasted error box. The System view renders lazily on first switch to
 * System/Both and is cached. Visibility is driven by the `data-mode` attribute
 * (see styles.css), so switching modes never re-renders an already-built view.
 *
 * Returns the container plus a `ready` promise that resolves once the eager
 * Beautiful render settles (a resolved no-op when there is no Beautiful slot) —
 * Reading View awaits it so tests and downstream passes observe a populated slot;
 * Live Preview ignores it.
 */
export function mountMermaidBlock(opts: MermaidBlockOptions): {
  container: HTMLElement;
  ready: Promise<void>;
} {
  const { host, source, modes } = opts;
  const offers = (mode: ViewMode): boolean => modes.includes(mode);

  // Clear any pre-existing children (e.g. the <pre><code class="language-mermaid">
  // that Obsidian injects into `el` before calling our code-block processor).
  // Leaving it would give the native mermaid PostProcessor something to scan
  // and render a second, bare diagram alongside ours.
  // Use standard DOM (not Obsidian's `.empty()`) so this works in jsdom tests too.
  while (host.firstChild) host.removeChild(host.firstChild);

  const container = host.createDiv({ cls: "abm-block" });
  const bar = container.createDiv({ cls: "abm-toolbar" });
  const views = container.createDiv({ cls: "abm-views" });

  // Create only the slots the offered modes can reach. "Both" needs the
  // Beautiful and System slots; Pele owns its own slot.
  const needsBeautiful = offers("beautiful") || offers("both");
  const needsPele = offers("pele");
  const needsSystem = offers("system") || offers("both");
  const beautifulSlot = needsBeautiful
    ? views.createDiv({ cls: "abm-view abm-view-beautiful" })
    : null;
  const peleSlot = needsPele ? views.createDiv({ cls: "abm-view abm-view-pele" }) : null;
  const systemSlot = needsSystem
    ? views.createDiv({ cls: "abm-view abm-view-system" })
    : null;
  const sourceSlot = views.createDiv({ cls: "abm-view abm-view-source" });

  // Source view: NEVER carries `language-mermaid`, so a stray rebuild can never
  // let the native post-processor render it.
  const pre = sourceSlot.createEl("pre");
  pre.createEl("code", { cls: "abm-source-code", text: source });

  // The mode the block starts in is rendered eagerly so the first paint is
  // populated; every other renderer is deferred to its first switch. `ready`
  // settles when the eager render does. It never rejects — render
  // implementations surface their own failures into the slot (see renderError),
  // so a bare `await ready` in callers cannot raise an unhandled rejection.
  const initial = opts.getMode();
  const rendererSlots: Record<RendererMode, HTMLElement | null> = {
    beautiful: beautifulSlot,
    pele: peleSlot,
    system: systemSlot,
  };
  const rendered = new Set<RendererMode>();

  const ensureRendered = (mode: RendererMode): void => {
    const slot = rendererSlots[mode];
    const render = opts.renderers[mode];
    if (!slot || !render || rendered.has(mode)) return;
    rendered.add(mode);
    void render(slot);
  };

  const ready = Promise.resolve(
    initial === "both"
      ? (ensureRendered("beautiful"), ensureRendered("system"))
      : initial === "source"
        ? undefined
        : ensureRendered(initial),
  );

  const buttons = new Map<ViewMode, HTMLElement>();

  const apply = (mode: ViewMode): void => {
    if (mode === "both") {
      ensureRendered("beautiful");
      ensureRendered("system");
    } else if (mode !== "source") {
      ensureRendered(mode);
    }
    container.dataset.mode = mode;
    for (const [candidate, button] of buttons) {
      const active = candidate === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  };

  // Buttons in canonical order, filtered to the offered modes.
  for (const mode of MODE_ORDER) {
    if (!offers(mode)) continue;
    const button = bar.createEl("button", {
      cls: "abm-toolbar-btn",
      text: MODE_LABELS[mode],
    });
    button.setAttribute("type", "button");
    button.dataset.mode = mode;
    // Clicking a button must not place the CodeMirror cursor inside the fence.
    // If it did, the fence decoration would rebuild around the selection, the
    // widget DOM (including this button) would be torn down mid-click, and the
    // click would never fire — the mode would silently snap back. The plugin
    // still lets all other mouse events through (see MermaidEditorWidget) so
    // text selection and cursor placement in the diagram area keep working.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      opts.setMode(mode);
      apply(mode);
    });
    buttons.set(mode, button);
  }

  apply(opts.getMode());

  return { container, ready };
}

/** Options for {@link mountMermaidBlock}. */
export interface MermaidBlockOptions {
  /** Element to render the block into. */
  host: HTMLElement;
  /** The mermaid fence source (declaration + body). */
  source: string;
  /** Modes to offer, as toolbar buttons (rendered in {@link MODE_ORDER} order). */
  modes: readonly ViewMode[];
  /** Read the block's current mode. */
  getMode: () => ViewMode;
  /** Persist the block's chosen mode. */
  setMode: (mode: ViewMode) => void;
  /**
   * Fill a renderer's slot (Beautiful, Pele, or System). Each entry is invoked at
   * most once per mount: eagerly for the initial mode, lazily on first switch
   * for the rest.
   */
  renderers: Partial<Record<RendererMode, (slot: HTMLElement) => void | Promise<void>>>;
}

/**
 * Whether beautiful-mermaid supports this fence's diagram type.
 *
 * We take over EVERY mermaid block regardless; this only selects the block's
 * default mode and the toolbar's button set (see {@link defaultModeFor} and
 * {@link allowedModes}).
 */
export function isSupportedType(source: string): boolean {
  const type = extractDiagramType(source);
  return type !== null && BEAUTIFUL_SUPPORTED.has(type);
}

/**
 * Whether pele can draw this fence. Its own detection throws on nothing, but we
 * still guard: a renderer probe must never break mounting.
 */
export function isPeleSupportedType(source: string): boolean {
  try {
    return peleSupports(source);
  } catch {
    return false;
  }
}

/**
 * The mode a block starts in: the preferred renderer when it can draw this type,
 * otherwise System (Obsidian's native render).
 */
export function defaultModeFor(
  source: string,
  preferred: PreferredRenderer = DEFAULT_PREFERRED_RENDERER,
): ViewMode {
  if (preferred === "beautiful") return isSupportedType(source) ? "beautiful" : "system";
  if (preferred === "pele") return isPeleSupportedType(source) ? "pele" : "system";
  return "system";
}

/**
 * The modes a block offers, in toolbar order. Each renderer button appears only
 * when that renderer can draw the type; System and Source are always available.
 * "Both" compares Beautiful against System, so it needs Beautiful support.
 */
export function allowedModes(source: string): readonly ViewMode[] {
  const modes: ViewMode[] = [];
  const beautiful = isSupportedType(source);
  if (beautiful) modes.push("beautiful");
  if (isPeleSupportedType(source)) modes.push("pele");
  modes.push("system");
  if (beautiful) modes.push("both");
  modes.push("source");
  return modes;
}

/** Key under which a block's mode is remembered: the trimmed fence source. */
export function modeKey(source: string): string {
  return source.trim();
}

/** Render an SVG string into a freshly-created `.abm-beautiful` container in `slot`. */
export function appendBeautiful(slot: HTMLElement, svg: string): void {
  appendRendered(slot, svg, "abm-beautiful");
}

/** Render an SVG string into a freshly-created `.abm-pele` container in `slot`. */
export function appendPele(slot: HTMLElement, svg: string): void {
  appendRendered(slot, svg, "abm-pele");
}

function appendRendered(slot: HTMLElement, svg: string, rendererClass: string): void {
  const container = slot.createDiv({ cls: `abm-container ${rendererClass}` });
  appendSvg(container, svg);
}

/**
 * Extract the diagram-type keyword from a mermaid code block.
 *
 * Skips YAML frontmatter (`---` … `---`), directive lines (`%%{...}%%` / `%%`),
 * and blank lines, then returns the lowercased first whitespace-delimited token
 * of the first meaningful line (e.g. "flowchart TD" -> "flowchart",
 * "stateDiagram-v2" -> "statediagram-v2"). Returns null if nothing is found.
 */
export function extractDiagramType(source: string): string | null {
  const lines = source.split("\n");
  let inFrontmatter = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) continue;

    // YAML frontmatter block.
    if (line === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;

    // Directive / comment lines (init configs, etc.).
    if (line.startsWith("%%")) continue;

    // First meaningful line: the diagram declaration.
    const firstToken = line.split(/\s+/)[0];
    return firstToken.toLowerCase();
  }

  return null;
}

/**
 * Parse an SVG string and append it to `host` as a real DOM node.
 *
 * Prefers a strict `image/svg+xml` parse (DOMParser + importNode, rather than
 * `innerHTML = svg`) to avoid the HTML parser's quirks with SVG/namespaced
 * markup and to keep the node bound to the host's owner document — which
 * matters inside Obsidian's editor surfaces where the host may live in a
 * detached or foreign document context.
 *
 * Mermaid 11 labels routinely contain HTML-ish fragments (`<br>` without the
 * XML self-closing slash, `<p>` wrappers inside `<foreignObject>`), which are
 * illegal in XML but exactly what Obsidian's own renderer tolerates via
 * innerHTML. When the strict parse fails, fall back to the HTML parser and
 * pull out the `<svg>` element it recovers — so valid diagrams whose labels
 * merely use HTML line breaks still render instead of erroring.
 *
 * Throws only if neither parse yields an `<svg>` element.
 */
export function appendSvg(host: HTMLElement, svg: string): void {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(svg, "image/svg+xml");
  let svgElement: Element | null = null;

  if (
    parsed.documentElement.nodeName.toLowerCase() === "svg" &&
    !parsed.querySelector("parsererror")
  ) {
    svgElement = parsed.documentElement;
  } else {
    // HTML parser: recovers foreignObject content the XML parser rejects.
    const recovered = parser.parseFromString(svg, "text/html").querySelector("svg");
    if (recovered) svgElement = recovered;
  }

  if (!svgElement) {
    throw new Error("Mermaid renderer returned invalid SVG");
  }

  const doc = host.ownerDocument ?? activeDocument;
  host.appendChild(doc.importNode(svgElement, true));
}

/** Render an error box with the engine name, the error message, and the raw source. */
export function renderError(
  el: HTMLElement,
  engine: string,
  error: unknown,
  source: string,
): void {
  const message = error instanceof Error ? error.message : String(error);

  const box = el.createDiv({ cls: "abm-error" });
  box.createDiv({
    cls: "abm-error-title",
    text: `Auto Beautiful Mermaid — ${engine} failed to render this diagram`,
  });
  box.createDiv({ cls: "abm-error-message", text: message });

  const pre = box.createEl("pre");
  pre.createEl("code", { text: source });
}

/** A located mermaid fenced code block within the editor document. */
export interface MermaidFence {
  /** Document offset of the opening fence line. */
  from: number;
  /** Document offset just past the closing fence line. */
  to: number;
  /** The mermaid source between the fences (declaration + body). */
  source: string;
}

/**
 * Scan raw document text for fenced ```mermaid code blocks.
 *
 * Recognises both backtick and tilde fences and requires the closing fence to
 * use the same marker character as the opener. Returns one entry per block with
 * its document range and inner source, in document order.
 */
export function findMermaidFences(docText: string): MermaidFence[] {
  const fences: MermaidFence[] = [];
  // Leading indentation is spaces/tabs only — `\s*` would greedily swallow the
  // preceding newline and push `from` onto the wrong line.
  const fencePattern = /^([ \t]*)(`{3,}|~{3,})[ \t]*([A-Za-z0-9_-]+)?[^\n\r]*$/gm;
  let opening: { from: number; marker: string } | null = null;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(docText)) != null) {
    const marker = match[2] ?? "";
    const language = (match[3] ?? "").toLowerCase();
    const lineEnd = docText.indexOf("\n", match.index);
    const afterLine = lineEnd === -1 ? docText.length : lineEnd + 1;

    if (!opening) {
      if (language === "mermaid") {
        opening = { from: match.index, marker: marker[0] ?? "`" };
      }
      continue;
    }

    // A closing fence must use the same marker character as its opener.
    if ((marker[0] ?? "`") !== opening.marker) continue;

    const sourceStart = docText.indexOf("\n", opening.from);
    const source =
      sourceStart === -1
        ? ""
        : docText.slice(sourceStart + 1, match.index).replace(/\n$/, "");

    fences.push({ from: opening.from, to: afterLine, source });
    opening = null;
  }

  return fences;
}

/** Whether any selection range overlaps the [from, to] document span. */
export function selectionIntersects(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** WidgetType that renders a mermaid fence inside the Live Preview editor. */
class MermaidEditorWidget extends WidgetType {
  constructor(
    private readonly plugin: AutoBeautifulMermaidPlugin,
    private readonly source: string,
  ) {
    super();
  }

  eq(other: MermaidEditorWidget): boolean {
    return this.source === other.source;
  }

  toDOM(): HTMLElement {
    return this.plugin.renderWidget(this.source);
  }

  ignoreEvent(event: Event): boolean {
    // Toolbar clicks are handled entirely by the widget's own listeners; letting
    // them reach CodeMirror would drop the cursor into the fence, rebuild the
    // decoration, and destroy this widget before the click fires. Everything
    // else passes through so the cursor can still be placed by clicking the
    // (hidden) fence area.
    return event.target instanceof HTMLElement &&
      event.target.closest(".abm-toolbar") != null;
  }
}

/**
 * Build the StateField that decorates every mermaid fence with a toggleable
 * widget in Live Preview. A fence is left as plain source whenever a selection
 * range intersects it, so editing the block shows the underlying code.
 */
export function createMermaidEditorExtension(
  plugin: AutoBeautifulMermaidPlugin,
): StateField<DecorationSet> {
  const buildDecorations = (state: EditorState): DecorationSet => {
    // Only act in Live Preview; the legacy source mode has no widgets.
    if (!state.field(editorLivePreviewField, false)) return Decoration.none;

    const builder = new RangeSetBuilder<Decoration>();
    const docText = state.doc.toString();

    for (const fence of findMermaidFences(docText)) {
      // Take over every mermaid fence (the widget's toolbar offers the type's
      // modes); leaving any to the built-in widget would reintroduce duplicate
      // rendering.
      if (selectionIntersects(state, fence.from, fence.to)) continue;

      builder.add(
        fence.from,
        fence.from,
        Decoration.widget({
          block: true,
          side: -1,
          widget: new MermaidEditorWidget(plugin, fence.source),
        }),
      );
      builder.add(fence.from, fence.to, Decoration.replace({ block: true }));
    }

    return builder.finish();
  };

  return StateField.define<DecorationSet>({
    create: buildDecorations,
    update: (_decorations, transaction) => buildDecorations(transaction.state),
    provide: (stateField) => EditorView.decorations.from(stateField),
  });
}

/** Settings tab: picks the renderer a block starts in. */
class AutoBeautifulMermaidSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: AutoBeautifulMermaidPlugin,
  ) {
    super(app, plugin);
  }

  /** Declarative definition: what Obsidian 1.13+ renders and searches. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Default renderer",
        desc: this.description,
        control: {
          type: "dropdown",
          key: "preferredRenderer",
          defaultValue: DEFAULT_PREFERRED_RENDERER,
          options: PREFERRED_LABELS,
        },
      },
    ];
  }

  /** Imperative fallback for Obsidian versions without the declarative API. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Default renderer")
      .setDesc(this.description)
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries<string>(PREFERRED_LABELS)) {
          dropdown.addOption(value, label);
        }
        dropdown.setValue(this.plugin.settings.preferredRenderer);
        dropdown.onChange((value) => void this.setControlValue("preferredRenderer", value));
      });
  }

  getControlValue(key: string): unknown {
    return key === "preferredRenderer" ? this.plugin.settings.preferredRenderer : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key !== "preferredRenderer" || typeof value !== "string") return;
    if (!(value in PREFERRED_MODE)) return;
    this.plugin.settings.preferredRenderer = value as PreferredRenderer;
    await this.plugin.saveSettings();
  }

  private readonly description =
    "Which renderer new mermaid blocks start in. The per-block toolbar still overrides it, " +
    "and a type the chosen renderer cannot draw falls back to System.";
}
