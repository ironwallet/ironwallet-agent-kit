import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

/** `npm run dev:manager` writes the running manager's capability URL here. */
function devProxy(): Record<string, ProxyOptions> | undefined {
  const file = fileURLToPath(new URL(".dev-manager.json", import.meta.url));
  if (!existsSync(file)) return undefined;
  const manager = new URL((JSON.parse(readFileSync(file, "utf8")) as { url: string }).url);
  return {
    "/api": {
      target: manager.origin,
      changeOrigin: true,
      // The manager only accepts same-origin writes.
      headers: { origin: manager.origin },
      rewrite: (path) => `${manager.pathname}${path}`,
    },
  };
}

export default defineConfig({
  root,
  // Served under an unguessable /<token>/ prefix, so every URL stays relative.
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist/web-ui",
    emptyOutDir: true,
    assetsDir: "static",
    // Fonts and icons must be files: CSP allows no data: fonts and no inline code.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    proxy: devProxy(),
  },
});
