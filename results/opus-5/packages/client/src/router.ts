/**
 * Hash router. Every screen is a `Screen` with mount/unmount and an optional
 * per-frame hook driven by main.ts's animation loop.
 */

export interface RouteParams {
  [key: string]: string;
}

export interface Screen {
  mount(host: HTMLElement, params: RouteParams): void;
  unmount(): void;
  /** Optional per-frame hook. `dtMs` is capped to avoid huge catch-up steps. */
  frame?(dtMs: number): void;
}

export type ScreenFactory = () => Screen;

export interface RouteDef {
  /** Pattern such as '/room/:code'. */
  path: string;
  factory: ScreenFactory;
}

interface CompiledRoute extends RouteDef {
  segments: string[];
}

let routes: CompiledRoute[] = [];
let fallback: ScreenFactory | null = null;
let host: HTMLElement | null = null;
let active: Screen | null = null;
let activePath = '';

function compile(route: RouteDef): CompiledRoute {
  return { ...route, segments: route.path.split('/').filter(Boolean) };
}

export function defineRoutes(defs: RouteDef[], notFound: ScreenFactory): void {
  routes = defs.map(compile);
  fallback = notFound;
}

function match(path: string): { factory: ScreenFactory; params: RouteParams } | null {
  const parts = path.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params: RouteParams = {};
    let ok = true;
    for (let i = 0; i < route.segments.length; i++) {
      const segment = route.segments[i];
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(parts[i]);
      } else if (segment !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { factory: route.factory, params };
  }
  return null;
}

export function currentPath(): string {
  const hash = location.hash.replace(/^#/, '');
  return hash.length > 0 ? hash : '/';
}

export function navigate(path: string, replace = false): void {
  const target = `#${path}`;
  if (location.hash === target) {
    render();
    return;
  }
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
  if (replace) render();
}

export function activeScreen(): Screen | null {
  return active;
}

function render(): void {
  if (!host) return;
  const path = currentPath();
  if (path === activePath && active) return;

  const found = match(path);
  const factory = found?.factory ?? fallback;
  if (!factory) return;

  active?.unmount();
  host.replaceChildren();
  activePath = path;
  active = factory();
  active.mount(host, found?.params ?? {});
}

export function startRouter(mountPoint: HTMLElement): void {
  host = mountPoint;
  window.addEventListener('hashchange', render);
  render();
}

/** Force the active screen to be rebuilt, e.g. after a profile change. */
export function refresh(): void {
  activePath = '';
  render();
}
