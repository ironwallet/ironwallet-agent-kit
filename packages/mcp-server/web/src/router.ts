import { useSyncExternalStore } from "react";

/**
 * Hash routing: the app lives under a random /<token>/ path and the server
 * only knows that one document, so the route stays in the fragment:
 * `#/<section>/<sub...>`.
 */
export const ROUTES = ["home", "wallets", "history", "backup", "tokens"] as const;
export type Route = (typeof ROUTES)[number];

export interface Location {
  route: Route;
  /** Path segments after the section, e.g. ["new"] for `#/wallets/new`. */
  rest: string[];
}

function parse(hash: string): Location {
  const [name = "", ...rest] = hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
  return (ROUTES as readonly string[]).includes(name)
    ? { route: name as Route, rest: rest.map(decodeURIComponent) }
    : { route: "home", rest: [] };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

let cachedHash = "";
let cached: Location = parse("");

function snapshot(): Location {
  const hash = window.location.hash;
  if (hash !== cachedHash) {
    cachedHash = hash;
    cached = parse(hash);
  }
  return cached;
}

export function useLocation(): Location {
  return useSyncExternalStore(subscribe, snapshot);
}

export function href(route: Route, ...rest: string[]): string {
  return `#/${[route, ...rest.map(encodeURIComponent)].join("/")}`;
}

export function navigate(route: Route, ...rest: string[]): void {
  window.location.hash = href(route, ...rest);
}
