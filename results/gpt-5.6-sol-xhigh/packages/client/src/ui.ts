import type { Animal, Hat, Profile } from "@splash/shared";

export type ClassValue = string | false | null | undefined;

export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(" ");
}

export type ElTag = keyof HTMLElementTagNameMap;

export interface ElProps {
  class?: ClassValue[];
  text?: string;
  html?: string;
  attrs?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  dataset?: Record<string, string>;
  on?: { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
  title?: string;
}

export function el<K extends ElTag>(
  tag: K,
  props: ElProps = {},
  children: Array<Node | string | null | undefined | false> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class && props.class.length) node.className = cx(...props.class);
  if (props.text !== undefined) node.textContent = props.text;
  else if (props.html !== undefined) node.innerHTML = props.html;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  if (props.style) Object.assign(node.style, props.style);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;
  if (props.title !== undefined) node.title = props.title;
  if (props.on) {
    for (const [key, handler] of Object.entries(props.on) as Array<[keyof HTMLElementEventMap, (e: never) => void]>) {
      node.addEventListener(key as string, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export type ButtonVariant = "default" | "ghost" | "pink" | "mint" | "coral";

export function button(
  label: string,
  onClick: () => void,
  opts: { variant?: ButtonVariant; size?: "tiny" | "normal" | "big"; class?: ClassValue[]; disabled?: boolean; title?: string } = {}
): HTMLButtonElement {
  const classes: ClassValue[] = ["sc-btn"];
  if (opts.variant === "ghost") classes.push("ghost");
  else if (opts.variant === "pink") classes.push("pink");
  else if (opts.variant === "mint") classes.push("mint");
  else if (opts.variant === "coral") classes.push("coral");
  if (opts.size === "tiny") classes.push("tiny");
  else if (opts.size === "big") classes.push("big");
  if (opts.class) classes.push(...opts.class);
  const b = el("button", { class: classes, text: label, ...(opts.title !== undefined ? { title: opts.title } : {}), on: { click: () => onClick() } }) as HTMLButtonElement;
  if (opts.disabled) b.disabled = true;
  return b;
}

export function panel(title: string | null, subtitle?: string, wide = false): { root: HTMLElement; body: HTMLElement } {
  const root = el("div", { class: ["sc-card", wide ? "wide" : undefined] });
  if (title) root.append(el("h2", { class: ["sc-title"], text: title }));
  if (subtitle) root.append(el("p", { class: ["sc-sub"], text: subtitle }));
  const body = el("div", { class: ["sc-stack"] });
  root.append(body);
  return { root, body };
}

export function field(label: string, input: HTMLElement): HTMLElement {
  return el("div", { class: ["sc-field"] }, [
    el("label", { text: label }),
    input
  ]);
}

export function textInput(opts: {
  value?: string;
  placeholder?: string;
  maxlength?: number;
  onInput?: (v: string) => void;
  onEnter?: (v: string) => void;
  class?: ClassValue[];
} = {}): HTMLInputElement {
  const input = el("input", {
    class: ["sc-input", ...(opts.class ?? [])],
    attrs: { type: "text", ...(opts.placeholder ? { placeholder: opts.placeholder } : {}), ...(opts.maxlength ? { maxlength: String(opts.maxlength) } : {}) },
    ...(opts.value !== undefined ? { text: opts.value } : {})
  }) as HTMLInputElement;
  if (opts.value !== undefined) input.value = opts.value;
  if (opts.onInput) input.addEventListener("input", () => opts.onInput!(input.value));
  if (opts.onEnter) input.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") opts.onEnter!(input.value); });
  return input;
}

export function select<T extends string>(
  options: Array<{ value: T; label: string }>,
  value: T,
  onChange: (v: T) => void
): HTMLSelectElement {
  const sel = el("select", { class: ["sc-select"] }) as HTMLSelectElement;
  for (const opt of options) {
    const o = el("option", { attrs: { value: opt.value }, text: opt.label }) as HTMLOptionElement;
    if (opt.value === value) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener("change", () => {
    const next = sel.value as T;
    onChange(next);
  });
  return sel;
}

export function toggle(checked: boolean, onChange: (v: boolean) => void): { root: HTMLElement; set: (v: boolean) => void } {
  const root = el("div", { class: ["sc-toggle", checked ? "on" : undefined] }, [
    el("div", { class: ["track"] }, [el("div", { class: ["knob"] })])
  ]);
  root.addEventListener("click", () => {
    const next = !root.classList.contains("on");
    root.classList.toggle("on", next);
    onChange(next);
  });
  return { root, set: (v) => root.classList.toggle("on", v) };
}

export function slider(opts: {
  min: number; max: number; step?: number; value: number;
  onChange: (v: number) => void;
}): HTMLInputElement {
  const s = el("input", {
    class: ["sc-slider"],
    attrs: { type: "range", min: String(opts.min), max: String(opts.max), step: String(opts.step ?? 1), value: String(opts.value) }
  }) as HTMLInputElement;
  s.value = String(opts.value);
  s.addEventListener("input", () => opts.onChange(Number(s.value)));
  return s;
}

export function keyCap(value: string, onCapture: (next: string) => void): { root: HTMLElement; set: (v: string) => void } {
  const label = el("span", { text: value.toUpperCase() || "—" });
  const root = el("div", { class: ["sc-key"], attrs: { tabindex: "0" } }, [label]);
  let recording = false;
  const finalize = (next: string) => {
    recording = false;
    root.classList.remove("recording");
    label.textContent = next.toUpperCase() || "—";
    onCapture(next);
  };
  const start = () => {
    recording = true;
    root.classList.add("recording");
    label.textContent = "PRESS…";
  };
  root.addEventListener("click", start);
  root.addEventListener("keydown", (e) => {
    const ev = e as KeyboardEvent;
    if (!recording) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); start(); }
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.key === "Escape") { finalize(value); return; }
    finalize(normalizeKey(ev));
  });
  return { root, set: (v: string) => { label.textContent = v.toUpperCase() || "—"; } };
}

export function normalizeKey(ev: KeyboardEvent): string {
  const k = ev.key;
  if (k === " ") return "Space";
  if (k.length === 1) return k.toUpperCase();
  return k;
}

export function toastArea(root: HTMLElement): { show: (msg: string, kind?: "info" | "good" | "bad") => void } {
  const area = el("div", { class: ["sc-toast-wrap"] });
  root.append(area);
  return {
    show(msg, kind = "info") {
      const t = el("div", { class: ["sc-toast", kind === "good" ? "good" : kind === "bad" ? "bad" : undefined], text: msg });
      area.append(t);
      window.setTimeout(() => t.remove(), 2900);
    }
  };
}

export function modal(host: HTMLElement, title: string, body: HTMLElement, actions: Array<{ label: string; variant?: ButtonVariant; onClick?: () => void; dismiss?: boolean }> = []): { close: () => void } {
  const backdrop = el("div", { class: ["sc-modal-backdrop"] });
  const card = el("div", { class: ["sc-modal"] });
  card.append(el("h3", { class: ["sc-title"], text: title }));
  card.append(body);
  const footer = el("div", { class: ["sc-btn-row"] });
  const close = () => backdrop.remove();
  for (const a of actions) {
    footer.append(button(a.label, () => { if (a.dismiss) close(); a.onClick?.(); }, { ...(a.variant !== undefined ? { variant: a.variant } : {}) }));
  }
  card.append(footer);
  backdrop.append(card);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  host.append(backdrop);
  return { close };
}

export function tierClass(tier: string): string {
  const t = tier.toLowerCase();
  return `sc-tag t-${t}`;
}

export function formatName(profile: Profile): string {
  return `${profile.nickname}#${profile.tag}`;
}

export function shortName(profile: Profile): string {
  return profile.nickname;
}

export const ANIMAL_LIST: Animal[] = ["frog", "duck", "otter", "penguin", "cat", "raccoon", "turtle", "capybara"];
export const HAT_LIST: Hat[] = ["none", "bucket", "snorkel", "crown", "bandana", "propeller"];

export function animalLabel(a: Animal): string {
  const labels: Record<Animal, string> = {
    frog: "FROG", duck: "DUCK", otter: "OTTER", penguin: "PENGUIN",
    cat: "CAT", raccoon: "RACCOON", turtle: "TURTLE", capybara: "CAPYBARA"
  };
  return labels[a];
}

export function hatLabel(h: Hat): string {
  const labels: Record<Hat, string> = {
    none: "NONE", bucket: "BUCKET", snorkel: "SNORKEL",
    crown: "CROWN", bandana: "BANDANA", propeller: "PROPELLER"
  };
  return labels[h];
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatETA(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
