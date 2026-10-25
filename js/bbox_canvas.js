// Bounding-box canvas DOM widget for the classic (Nodes 1.0) frontend.
// Ported from the core Nodes 2.0 widget (useBoundingBoxes.ts / boundingBoxesUtil.ts)
// so the stored value is the same pixel-space BoundingBox list with metadata.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "CreateBoundingBoxesLegacy";
const STATE_WIDGET = "editor_state";
const INCOMING_WIDGET = "last_incoming";

const HANDLE_PX = 8;
const DIMENSION_STEP = 16;
const BG_DIM = 0.75;
const MAX_ELEMENT_COLORS = 5;
const GRID_PX = 32;
const MAX_GRID_CELLS = 64;
const DOT_ALPHA = 0.18;
const DOT_RADIUS = 1;
const TOOLBAR_H = 30;
const PANEL_H = 176;
const MIN_CANVAS_H = 160;
const DEFAULT_PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6", "#bcf60c"];

// ---------- geometry (port of boundingBoxesUtil.ts) ----------

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function normalizeBox(b) {
  let { x, y, w, h } = b;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  x = clamp01(x);
  y = clamp01(y);
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  return { ...b, x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

function rectHitTest(mx, my, x1, y1, x2, y2, rx, ry) {
  const near = (cx, cy) => Math.abs(mx - cx) < rx && Math.abs(my - cy) < ry;
  if (near(x1, y1)) return "resize-tl";
  if (near(x2, y1)) return "resize-tr";
  if (near(x1, y2)) return "resize-bl";
  if (near(x2, y2)) return "resize-br";
  if (mx >= x1 && mx <= x2 && Math.abs(my - y1) < ry) return "resize-t";
  if (mx >= x1 && mx <= x2 && Math.abs(my - y2) < ry) return "resize-b";
  if (my >= y1 && my <= y2 && Math.abs(mx - x1) < rx) return "resize-l";
  if (my >= y1 && my <= y2 && Math.abs(mx - x2) < rx) return "resize-r";
  if (mx >= x1 && mx <= x2 && my >= y1 && my <= y2) return "move";
  return null;
}

function applyDrag(mode, start, dx, dy) {
  let { x, y, w, h } = start;
  switch (mode) {
    case "move":
      x = clamp01(Math.min(x + dx, 1 - w));
      y = clamp01(Math.min(y + dy, 1 - h));
      return { ...start, x, y };
    case "draw":
    case "resize-br": w += dx; h += dy; break;
    case "resize-tl": x += dx; y += dy; w -= dx; h -= dy; break;
    case "resize-tr": y += dy; w += dx; h -= dy; break;
    case "resize-bl": x += dx; w -= dx; h += dy; break;
    case "resize-t": y += dy; h -= dy; break;
    case "resize-b": h += dy; break;
    case "resize-l": x += dx; w -= dx; break;
    case "resize-r": w += dx; break;
  }
  return normalizeBox({ ...start, x, y, w, h });
}

function boxesAt(regions, mx, my, logW, logH, activeIdx) {
  const rx = HANDLE_PX / Math.max(1, logW);
  const ry = HANDLE_PX / Math.max(1, logH);
  const res = [];
  regions.forEach((b, i) => {
    const mode = rectHitTest(mx, my, b.x, b.y, b.x + b.w, b.y + b.h, rx, ry);
    if (mode) res.push({ index: i, mode });
  });
  const ai = res.findIndex((c) => c.index === activeIdx);
  if (ai > 0) res.unshift(res.splice(ai, 1)[0]);
  return res;
}

function tagRects(regions, logW, logH, measure, height = 14) {
  const placed = [];
  const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  return regions.map((b, i) => {
    const x1 = b.x * logW, y1 = b.y * logH;
    const x2 = (b.x + b.w) * logW, y2 = (b.y + b.h) * logH;
    const tag = String(i + 1).padStart(2, "0");
    const w = measure(tag) + 8;
    let pick = [x1, y1];
    for (const [cx, cy] of [[x1, y1], [x2 - w, y1], [x2 - w, y2 - height], [x1, y2 - height]]) {
      const cand = { x: cx, y: cy, w, h: height };
      if (!placed.some((p) => hits(cand, p))) { pick = [cx, cy]; break; }
    }
    const r = { x: pick[0], y: pick[1], w, h: height, tag };
    placed.push(r);
    return r;
  });
}

function isBoundingBox(b) {
  return !!b && typeof b === "object" &&
    typeof b.x === "number" && typeof b.y === "number" &&
    typeof b.width === "number" && typeof b.height === "number";
}

function normalizeHexColor(color) {
  if (typeof color !== "string") return null;
  const hex = color.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(hex) ? hex : null;
}

function fromBoundingBoxes(boxes, width, height) {
  const w = width || 1, h = height || 1;
  return (Array.isArray(boxes) ? boxes : []).filter(isBoundingBox).map((box) => {
    const meta = box.metadata && typeof box.metadata === "object" ? box.metadata : {};
    return {
      x: box.x / w, y: box.y / h, w: box.width / w, h: box.height / h,
      type: meta.type === "text" ? "text" : "obj",
      text: typeof meta.text === "string" ? meta.text : "",
      desc: typeof meta.desc === "string" ? meta.desc : "",
      palette: Array.isArray(meta.palette) ? meta.palette.map(normalizeHexColor).filter(Boolean) : [],
    };
  });
}

function toBoundingBoxes(regions, width, height) {
  return regions.map((r) => ({
    x: Math.round(r.x * width),
    y: Math.round(r.y * height),
    width: Math.round(r.w * width),
    height: Math.round(r.h * height),
    metadata: { type: r.type, text: r.text, desc: r.desc, palette: r.palette.slice() },
  }));
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const data = JSON.parse(value);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function luminance(hex) {
  const n = normalizeHexColor(hex) || "#8c8c8c";
  const r = parseInt(n.slice(1, 3), 16), g = parseInt(n.slice(3, 5), 16), b = parseInt(n.slice(5, 7), 16);
  return [r, g, b, 0.299 * r + 0.587 * g + 0.114 * b];
}

// Lighten dark colours so text stays legible on the dark canvas.
function readableTextColor(hex) {
  const [r, g, b, lum] = luminance(hex);
  if (lum >= 130) return `rgb(${r},${g},${b})`;
  const t = (130 - lum) / (255 - lum);
  return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`;
}

const textOnColor = (hex) => (luminance(hex)[3] > 140 ? "#000" : "#fff");

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

function el(tag, style = {}, props = {}) {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  Object.assign(e, props);
  return e;
}

function hideWidget(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
}

// ---------- editor ----------

class BBoxEditor {
  constructor(node) {
    this.node = node;
    this.regions = [];
    this.activeIndex = -1;
    this.hoverIndex = null;
    this.hoverTagIndex = null;
    this.drag = null;
    this.focused = false;
    this.bgImage = null;
    this.bgUrl = null;
    this.raf = 0;
    this.grid = node.properties?.bboxGrid ?? true;
    this.buildDom();
    this.loadFromWidget();
  }

  widget(name) {
    return this.node.widgets?.find((w) => w.name === name);
  }

  dim(name) {
    const v = this.widget(name)?.value;
    return typeof v === "number" && v > 0 ? v : 1024;
  }

  get W() { return this.dim("width"); }
  get H() { return this.dim("height"); }

  // ----- DOM -----

  buildDom() {
    const btn = (label, title) => el("button", {
      background: "var(--comfy-input-bg, #222)", color: "var(--input-text, #ddd)",
      border: "1px solid var(--border-color, #444)", borderRadius: "4px",
      padding: "2px 8px", fontSize: "12px", cursor: "pointer",
    }, { textContent: label, title, type: "button" });

    this.root = el("div", {
      display: "flex", flexDirection: "column", gap: "4px",
      width: "100%", height: "100%", boxSizing: "border-box",
      fontFamily: "sans-serif", fontSize: "12px", color: "var(--input-text, #ddd)",
    });

    const toolbar = el("div", { display: "flex", alignItems: "center", gap: "6px", height: `${TOOLBAR_H - 4}px`, flex: "0 0 auto" });
    this.gridBtn = btn("Grid", "Toggle snap-to-grid");
    this.gridBtn.onclick = () => this.setGrid(!this.grid);
    const clearBtn = btn("Clear all", "Remove every box");
    clearBtn.onclick = () => this.clearAll();
    this.info = el("span", { marginLeft: "auto", opacity: "0.6", whiteSpace: "nowrap", overflow: "hidden" });
    toolbar.append(this.gridBtn, clearBtn, this.info);

    this.area = el("div", {
      flex: "1 1 auto", minHeight: `${MIN_CANVAS_H}px`, position: "relative",
      display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
    });
    this.canvas = el("canvas", {
      background: "#111", border: "1px solid var(--border-color, #444)", borderRadius: "4px",
      cursor: "crosshair", outline: "none", touchAction: "none", boxSizing: "border-box",
    }, { tabIndex: 0 });
    this.area.append(this.canvas);

    this.panel = el("div", {
      flex: `0 0 ${PANEL_H}px`, height: `${PANEL_H}px`, boxSizing: "border-box",
      display: "flex", flexDirection: "column", gap: "4px", padding: "6px",
      background: "rgba(0,0,0,0.25)", borderRadius: "4px", overflow: "hidden",
    });
    this.buildPanel(btn);

    this.root.append(toolbar, this.area, this.panel);

    // Keep LiteGraph from dragging the node or stealing keys while editing.
    for (const type of ["pointerdown", "mousedown", "keydown", "keyup", "contextmenu", "dblclick"]) {
      this.root.addEventListener(type, (e) => e.stopPropagation());
    }

    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    c.addEventListener("pointermove", (e) => (this.drag ? this.onDragMove(e) : this.onHover(e)));
    c.addEventListener("pointerup", (e) => this.onPointerUp(e));
    c.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    c.addEventListener("lostpointercapture", (e) => this.onPointerUp(e));
    c.addEventListener("pointerleave", () => this.setHover(null, null));
    c.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    c.addEventListener("keydown", (e) => this.onKeyDown(e));
    c.addEventListener("focus", () => { this.focused = true; this.requestDraw(); });
    c.addEventListener("blur", () => { this.focused = false; this.requestDraw(); });

    new ResizeObserver(() => this.layout()).observe(this.area);
    this.updateGridBtn();
  }

  buildPanel(btn) {
    const p = this.panel;
    this.emptyHint = el("div", { opacity: "0.6", padding: "4px" }, {
      textContent: "Drag on the canvas to draw a box. Draw background elements first and foreground last.",
    });

    this.editor = el("div", { display: "flex", flexDirection: "column", gap: "4px", height: "100%" });
    const row = el("div", { display: "flex", gap: "4px", alignItems: "center" });
    this.title = el("span", { fontWeight: "bold", minWidth: "48px" });
    this.objBtn = btn("Object", "Region holds an object");
    this.textBtn = btn("Text", "Region holds rendered text");
    this.objBtn.onclick = () => this.setActiveType("obj");
    this.textBtn.onclick = () => this.setActiveType("text");
    const delBtn = btn("Delete", "Delete this box (Del)");
    delBtn.style.marginLeft = "auto";
    delBtn.onclick = () => this.removeActive();
    row.append(this.title, this.objBtn, this.textBtn, delBtn);

    const area = (placeholder, rows) => el("textarea", {
      width: "100%", boxSizing: "border-box", resize: "none", fontSize: "12px",
      background: "var(--comfy-input-bg, #222)", color: "var(--input-text, #ddd)",
      border: "1px solid var(--border-color, #444)", borderRadius: "4px", padding: "3px 5px",
    }, { placeholder, rows });
    this.textInput = area("Exact text to render", 1);
    this.descInput = area("Description of this region…", 3);
    this.descInput.style.flex = "1 1 auto";
    this.textInput.addEventListener("input", () => this.editActive({ text: this.textInput.value }));
    this.descInput.addEventListener("input", () => this.editActive({ desc: this.descInput.value }));

    this.paletteRow = el("div", { display: "flex", gap: "4px", alignItems: "center", flex: "0 0 auto" });

    this.editor.append(row, this.textInput, this.descInput, this.paletteRow);
    p.append(this.emptyHint, this.editor);
  }

  renderPanel() {
    const r = this.activeRegion();
    this.emptyHint.style.display = r ? "none" : "block";
    this.editor.style.display = r ? "flex" : "none";
    this.info.textContent = `${this.regions.length} box${this.regions.length === 1 ? "" : "es"} · ${this.W}×${this.H}`;
    if (!r) return;
    this.title.textContent = `#${String(this.activeIndex + 1).padStart(2, "0")}`;
    const sel = (b, on) => {
      b.style.background = on ? "var(--comfy-menu-bg, #444)" : "var(--comfy-input-bg, #222)";
      b.style.fontWeight = on ? "bold" : "normal";
    };
    sel(this.objBtn, r.type === "obj");
    sel(this.textBtn, r.type === "text");
    this.textInput.style.display = r.type === "text" ? "block" : "none";
    if (document.activeElement !== this.textInput) this.textInput.value = r.text;
    if (document.activeElement !== this.descInput) this.descInput.value = r.desc;
    this.renderPalette(r);
  }

  renderPalette(r) {
    const row = this.paletteRow;
    row.replaceChildren(el("span", { opacity: "0.7", marginRight: "2px" }, { textContent: "Colors" }));
    r.palette.forEach((color, i) => {
      const input = el("input", {
        width: "22px", height: "20px", padding: "0", border: "1px solid #555", borderRadius: "3px", cursor: "pointer",
      }, { type: "color", value: color.slice(0, 7), title: "Click to change, right-click to remove" });
      input.addEventListener("input", () => {
        r.palette[i] = input.value;
        this.commit(false);
      });
      input.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        r.palette.splice(i, 1);
        this.commit();
      });
      row.append(input);
    });
    if (r.palette.length < MAX_ELEMENT_COLORS) {
      const add = el("button", {
        width: "22px", height: "20px", padding: "0", cursor: "pointer", borderRadius: "3px",
        background: "transparent", color: "inherit", border: "1px dashed #666",
      }, { textContent: "+", type: "button", title: "Add a colour" });
      add.onclick = () => {
        const used = new Set(this.regions.flatMap((x) => x.palette));
        r.palette.push(DEFAULT_PALETTE.find((c) => !used.has(c)) ?? DEFAULT_PALETTE[0]);
        this.commit();
      };
      row.append(add);
    }
  }

  // Fit the canvas inside its area at the width:height aspect ratio.
  layout() {
    const aw = this.area.clientWidth, ah = this.area.clientHeight;
    if (!aw || !ah) return;
    const ratio = this.W / this.H;
    let w = aw, h = aw / ratio;
    if (h > ah) { h = ah; w = ah * ratio; }
    this.canvas.style.width = `${Math.floor(w)}px`;
    this.canvas.style.height = `${Math.floor(h)}px`;
    this.requestDraw();
  }

  minHeight() {
    return TOOLBAR_H + PANEL_H + MIN_CANVAS_H + 12;
  }

  // ----- state -----

  activeRegion() {
    return this.activeIndex >= 0 ? this.regions[this.activeIndex] ?? null : null;
  }

  loadFromWidget() {
    this.regions = fromBoundingBoxes(parseList(this.widget(STATE_WIDGET)?.value), this.W, this.H);
    this.activeIndex = this.regions.length ? 0 : -1;
    this.renderPanel();
    this.layout();
  }

  commit(rerenderPanel = true) {
    const w = this.widget(STATE_WIDGET);
    if (w) {
      const value = JSON.stringify(toBoundingBoxes(this.regions, this.W, this.H));
      if (w.value !== value) {
        w.value = value;
        w.callback?.(value);
        this.node.graph?.setDirtyCanvas?.(true, false);
      }
    }
    if (rerenderPanel) this.renderPanel();
    this.requestDraw();
  }

  editActive(patch) {
    const r = this.activeRegion();
    if (!r) return;
    Object.assign(r, patch);
    this.commit(false);
  }

  setActiveType(type) {
    const r = this.activeRegion();
    if (!r) return;
    r.type = type;
    this.commit();
  }

  removeRegion(i) {
    this.regions.splice(i, 1);
    if (!this.regions.length) this.activeIndex = -1;
    else if (i <= this.activeIndex) this.activeIndex = Math.max(0, this.activeIndex - 1);
  }

  removeActive() {
    if (this.activeIndex < 0) return;
    this.removeRegion(this.activeIndex);
    this.commit();
  }

  clearAll() {
    this.regions = [];
    this.activeIndex = -1;
    this.setLastIncoming([]);
    this.commit();
  }

  setGrid(on) {
    this.grid = on;
    this.node.properties = this.node.properties || {};
    this.node.properties.bboxGrid = on;
    this.updateGridBtn();
    this.requestDraw();
  }

  updateGridBtn() {
    this.gridBtn.style.background = this.grid ? "var(--comfy-menu-bg, #444)" : "var(--comfy-input-bg, #222)";
    this.gridBtn.style.fontWeight = this.grid ? "bold" : "normal";
  }

  // Width/height changed: keep boxes at the same relative position.
  onDimsChanged() {
    this.commit();
    this.layout();
  }

  setLastIncoming(boxes) {
    const w = this.widget(INCOMING_WIDGET);
    if (w) w.value = JSON.stringify(boxes);
  }

  // Mirrors the core node: a new upstream `bboxes` value replaces the canvas once.
  applyIncoming(incoming) {
    if (!Array.isArray(incoming) || !incoming.length || !incoming.every(isBoundingBox) || this.drag) return;
    const applied = parseList(this.widget(INCOMING_WIDGET)?.value);
    if (JSON.stringify(applied) === JSON.stringify(incoming)) return;
    this.regions = fromBoundingBoxes(incoming, this.W, this.H);
    this.activeIndex = this.regions.length ? 0 : -1;
    this.setLastIncoming(incoming);
    this.commit();
  }

  // ----- background -----

  setBackgroundUrl(url) {
    if (url === this.bgUrl) return;
    this.bgUrl = url;
    if (!url) {
      this.bgImage = null;
      this.requestDraw();
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (this.bgUrl !== url) return;
      this.bgImage = img;
      this.applyImageDimensions(img.naturalWidth, img.naturalHeight);
      this.requestDraw();
    };
    img.src = url;
  }

  applyImageDimensions(nw, nh) {
    const snap = (v) => Math.max(DIMENSION_STEP, Math.round(v / DIMENSION_STEP) * DIMENSION_STEP);
    let changed = false;
    for (const [name, v] of [["width", snap(nw)], ["height", snap(nh)]]) {
      const w = this.widget(name);
      if (w && w.value !== v) {
        w.value = v;
        changed = true;
      }
    }
    if (changed) this.onDimsChanged();
  }

  // Like the core node: the background dictates the resolution, so hide width/height.
  setDimsHidden(hidden) {
    if (this.dimsHidden === hidden) return;
    this.dimsHidden = hidden;
    for (const name of ["width", "height"]) {
      const w = this.widget(name);
      if (w) w.hidden = hidden;
    }
    this.node.setDirtyCanvas?.(true, true);
  }

  // Use the upstream node's own preview (e.g. Load Image) without needing a run.
  refreshBackgroundFromGraph() {
    const node = this.node;
    const slot = node.findInputSlot?.("background") ?? -1;
    const linkId = slot >= 0 ? node.inputs[slot]?.link : null;
    this.setDimsHidden(linkId != null);
    if (linkId == null) {
      this.executedBgUrl = null;
      this.setBackgroundUrl(null);
      return;
    }
    const graph = node.graph ?? app.graph;
    const link = graph?.links?.get ? graph.links.get(linkId) : graph?.links?.[linkId];
    const src = link ? graph.getNodeById(link.origin_id) : null;
    const upstream = src?.imgs?.[0]?.src;
    this.setBackgroundUrl(upstream || this.executedBgUrl || null);
  }

  // ----- pointer handling -----

  logical() {
    return { w: this.canvas.clientWidth || 1, h: this.canvas.clientHeight || 1 };
  }

  pointerNorm(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  }

  gridSpec() {
    const f = (size) => Math.max(GRID_PX, Math.ceil(size / MAX_GRID_CELLS)) / size;
    return { fx: f(this.W), fy: f(this.H) };
  }

  snapRegion(region, mode) {
    if (!this.grid) return region;
    const { fx, fy } = this.gridSpec();
    const snap = (v, step) => clamp01(Math.round(v / step) * step);
    if (mode === "move") {
      return { ...region, x: Math.min(snap(region.x, fx), 1 - region.w), y: Math.min(snap(region.y, fy), 1 - region.h) };
    }
    const all = mode === "draw";
    const L = all || /-(l|tl|bl)$/.test(mode);
    const R = all || /-(r|tr|br)$/.test(mode);
    const T = all || /-(t|tl|tr)$/.test(mode);
    const B = all || /-(b|bl|br)$/.test(mode);
    const x1 = L ? snap(region.x, fx) : region.x;
    const y1 = T ? snap(region.y, fy) : region.y;
    const x2 = R ? snap(region.x + region.w, fx) : region.x + region.w;
    const y2 = B ? snap(region.y + region.h, fy) : region.y + region.h;
    return { ...region, x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
  }

  titleAt(m) {
    const ctx = this.canvas.getContext("2d");
    const { w: W, h: H } = this.logical();
    ctx.font = "bold 11px monospace";
    const rects = tagRects(this.regions, W, H, (s) => ctx.measureText(s).width);
    const px = m.x * W, py = m.y * H;
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
    }
    return null;
  }

  pick(m, cycle) {
    const { w: W, h: H } = this.logical();
    const cands = boxesAt(this.regions, m.x, m.y, W, H, this.activeIndex);
    if (!cands.length) return null;
    const activeResize = cands.find((c) => c.index === this.activeIndex && c.mode !== "move");
    if (activeResize && !cycle) return activeResize;
    const ti = this.titleAt(m);
    if (ti !== null && !cycle) return { index: ti, mode: "move" };
    if (cycle && cands.length > 1) {
      const pos = cands.findIndex((c) => c.index === this.activeIndex);
      return cands[(pos + 1) % cands.length];
    }
    return activeResize || cands[0];
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    this.canvas.focus();
    this.setHover(null, null);
    const m = this.pointerNorm(e);
    const hit = this.pick(m, e.altKey);
    let mode;
    if (hit) {
      this.activeIndex = hit.index;
      mode = hit.mode;
    } else {
      mode = "draw";
      this.regions.push({ x: m.x, y: m.y, w: 0, h: 0, type: "obj", text: "", desc: "", palette: [] });
      this.activeIndex = this.regions.length - 1;
    }
    this.drag = { mode, start: m, box: { ...this.regions[this.activeIndex] } };
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.renderPanel();
    this.requestDraw();
  }

  onDragMove(e) {
    const m = this.pointerNorm(e);
    const { mode, start, box } = this.drag;
    const nb = applyDrag(mode, box, m.x - start.x, m.y - start.y);
    this.regions[this.activeIndex] = this.snapRegion(nb, mode);
    this.requestDraw();
  }

  onPointerUp(e) {
    if (!this.drag) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const b = this.regions[this.activeIndex];
    if (b && (b.w < 0.005 || b.h < 0.005)) this.removeRegion(this.activeIndex);
    this.commit();
  }

  onHover(e) {
    const m = this.pointerNorm(e);
    const ti = this.titleAt(m);
    const { w: W, h: H } = this.logical();
    const cands = boxesAt(this.regions, m.x, m.y, W, H, this.activeIndex);
    const hit = cands.find((c) => c.index === this.activeIndex && c.mode !== "move") || cands[0];
    this.setHover(ti ?? (hit ? hit.index : null), ti, hit?.mode);
  }

  setHover(index, tagIndex, mode) {
    const cursors = {
      "resize-tl": "nwse-resize", "resize-br": "nwse-resize", "resize-tr": "nesw-resize", "resize-bl": "nesw-resize",
      "resize-t": "ns-resize", "resize-b": "ns-resize", "resize-l": "ew-resize", "resize-r": "ew-resize", move: "move",
    };
    this.canvas.style.cursor = tagIndex != null ? "pointer" : cursors[mode] || "crosshair";
    if (index === this.hoverIndex && tagIndex === this.hoverTagIndex) return;
    this.hoverIndex = index;
    this.hoverTagIndex = tagIndex;
    this.requestDraw();
  }

  onDoubleClick(e) {
    e.preventDefault();
    const m = this.pointerNorm(e);
    const { w: W, h: H } = this.logical();
    const cands = boxesAt(this.regions, m.x, m.y, W, H, this.activeIndex);
    const target = cands.find((c) => c.index === this.activeIndex) || cands[0];
    if (!target) return;
    this.activeIndex = target.index;
    this.renderPanel();
    this.descInput.focus();
    this.descInput.select();
  }

  onKeyDown(e) {
    if (this.drag) return;
    if ((e.key === "Delete" || e.key === "Backspace") && this.activeIndex >= 0) {
      e.preventDefault();
      this.removeActive();
    }
  }

  // ----- drawing -----

  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  draw() {
    const c = this.canvas;
    const { w: W, h: H } = this.logical();
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (this.bgImage) {
      ctx.drawImage(this.bgImage, 0, 0, W, H);
      ctx.fillStyle = `rgba(0,0,0,${BG_DIM})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.grid) this.drawDots(ctx, W, H);

    const aIdx = this.activeIndex;
    const order = this.regions.map((_, i) => i).filter((i) => i !== aIdx).reverse();
    if (aIdx >= 0 && aIdx < this.regions.length) order.push(aIdx);

    ctx.font = "bold 11px monospace";
    const tags = tagRects(this.regions, W, H, (s) => ctx.measureText(s).width);

    for (const i of order) {
      const b = this.regions[i];
      const active = i === aIdx;
      const pal = b.palette.filter(Boolean);
      const col = pal.length ? pal[0].slice(0, 7) : "#8c8c8c";
      const x1 = b.x * W, y1 = b.y * H, w = b.w * W, h = b.h * H;
      const hovered = active || i === this.hoverIndex;

      if (active) {
        ctx.fillStyle = "rgba(26,26,26,0.88)";
        ctx.fillRect(x1, y1, w, h);
      }
      ctx.fillStyle = col + (hovered ? "3a" : "22");
      ctx.fillRect(x1, y1, w, h);
      const lw = active ? 2 : hovered ? 1.5 : 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.strokeRect(x1 + lw / 2, y1 + lw / 2, w - lw, h - lw);

      if (pal.length) {
        const sw = w / pal.length;
        for (let p = 0; p < pal.length; p++) {
          const sx = x1 + Math.round(p * sw);
          ctx.fillStyle = pal[p];
          ctx.fillRect(sx, y1, x1 + Math.round((p + 1) * sw) - sx, 7);
        }
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(x1, y1, w, h);
      ctx.clip();
      let body = b.desc || "";
      if (b.type === "text" && b.text) body = `"${b.text}"` + (body ? ` — ${body}` : "");
      if (body) {
        ctx.font = "12px monospace";
        ctx.fillStyle = readableTextColor(col);
        let ty = y1 + 27;
        for (const line of wrapLines(ctx, body, w - 8)) {
          if (ty > y1 + h) break;
          ctx.fillText(line, x1 + 4, ty);
          ty += 14;
        }
      }
      const tr = tags[i];
      ctx.font = "bold 11px monospace";
      ctx.fillStyle = col;
      ctx.fillRect(tr.x, tr.y, tr.w, 14);
      if (i === this.hoverTagIndex) {
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fillRect(tr.x, tr.y, tr.w, 14);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(tr.x + 0.5, tr.y + 0.5, tr.w - 1, 13);
      }
      ctx.fillStyle = textOnColor(col);
      ctx.fillText(tr.tag, tr.x + 4, tr.y + 11);
      ctx.restore();
    }
  }

  drawDots(ctx, W, H) {
    const { fx, fy } = this.gridSpec();
    // Too dense to read at small sizes; it just looks like stripes.
    if (fx * W < 6 || fy * H < 6) return;
    const cols = Math.round(1 / fx), rows = Math.round(1 / fy);
    ctx.save();
    ctx.globalAlpha = DOT_ALPHA;
    ctx.fillStyle = "#ddd";
    ctx.beginPath();
    for (let i = 0; i <= cols; i++) {
      const cx = Math.min(1, i * fx) * W;
      for (let j = 0; j <= rows; j++) {
        const cy = Math.min(1, j * fy) * H;
        ctx.moveTo(cx + DOT_RADIUS, cy);
        ctx.arc(cx, cy, DOT_RADIUS, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.restore();
  }
}

// ---------- registration ----------

function viewUrl(img) {
  const params = new URLSearchParams({ filename: img.filename, type: img.type || "temp", subfolder: img.subfolder || "" });
  return api.apiURL(`/view?${params}`);
}

app.registerExtension({
  name: "comfyui-bbox-legacy.CreateBoundingBoxesLegacy",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_CLASS) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);
      hideWidget(this.widgets?.find((w) => w.name === STATE_WIDGET));
      hideWidget(this.widgets?.find((w) => w.name === INCOMING_WIDGET));

      const editor = new BBoxEditor(this);
      this.bboxEditor = editor;
      this.addDOMWidget("bbox_canvas", "bbox_canvas", editor.root, {
        serialize: false,
        hideOnZoom: false,
        // The properties panel re-parents DOM widget elements into itself when the
        // node is selected, which squeezed the editor into the panel's width.
        hideInPanel: true,
        getMinHeight: () => editor.minHeight(),
      });

      for (const name of ["width", "height"]) {
        const w = this.widgets?.find((x) => x.name === name);
        if (!w) continue;
        const cb = w.callback;
        w.callback = function () {
          const res = cb?.apply(this, arguments);
          editor.onDimsChanged();
          return res;
        };
      }

      const [w, h] = this.size;
      this.setSize([Math.max(w, 440), Math.max(h, 680)]);
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      const editor = this.bboxEditor;
      if (editor) {
        if (typeof this.properties?.bboxGrid === "boolean") editor.setGrid(this.properties.bboxGrid);
        editor.loadFromWidget();
        queueMicrotask(() => editor.refreshBackgroundFromGraph());
      }
      return r;
    };

    const onConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = onConnectionsChange?.apply(this, arguments);
      this.bboxEditor?.refreshBackgroundFromGraph();
      return r;
    };

    // Cheap per-frame check so a Load Image upstream shows up as soon as it is picked.
    const onDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      const r = onDrawForeground?.apply(this, arguments);
      this.bboxEditor?.refreshBackgroundFromGraph();
      return r;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const r = onExecuted?.apply(this, arguments);
      const editor = this.bboxEditor;
      if (editor && message) {
        const bg = message.background_images?.[0];
        editor.executedBgUrl = bg ? viewUrl(bg) : null;
        // The backend used the background's real size; adopt it right away.
        if (bg && Array.isArray(message.dims)) editor.applyImageDimensions(...message.dims);
        editor.refreshBackgroundFromGraph();
        editor.applyIncoming(message.input_bboxes);
      }
      return r;
    };
  },
});
