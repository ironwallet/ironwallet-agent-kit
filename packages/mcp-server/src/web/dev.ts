/**
 * `npm run dev:manager`: run the wallet manager without the MCP stdio server,
 * for UI work. Writes the capability URL to web/.dev-manager.json so the Vite
 * dev server (`npm run dev:web`) can proxy `/api` to it. Uses the real
 * keystore unless IW_KEYSTORE_DIR points elsewhere.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureManager } from "./manager.js";

const url = await ensureManager({ idleMs: 0 });
const file = fileURLToPath(new URL("../../web/.dev-manager.json", import.meta.url));
writeFileSync(file, `${JSON.stringify({ url }, null, 2)}\n`);
process.stdout.write(`Wallet manager: ${url}/\nVite proxy target written to ${file}\n`);
