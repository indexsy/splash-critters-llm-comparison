/**
 * Tiny DOM helpers for building the menu screens (no framework).
 */
export type Attrs = {
    class?: string;
    text?: string;
    html?: string;
    onclick?: (e: MouseEvent) => void;
    oninput?: (e: Event) => void;
    onchange?: (e: Event) => void;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    maxLength?: number;
    style?: string;
    title?: string;
    [key: string]: unknown;
};
export declare function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, children?: (HTMLElement | string)[]): HTMLElementTagNameMap[K];
export declare function btn(label: string, opts?: Attrs & {
    variant?: string;
}): HTMLButtonElement;
export declare function screenEl(narrow?: boolean): HTMLDivElement;
export declare function clearNode(el: HTMLElement): void;
export declare function toast(msg: string, bad?: boolean): void;
//# sourceMappingURL=ui.d.ts.map