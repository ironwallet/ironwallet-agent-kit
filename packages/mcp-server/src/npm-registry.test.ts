import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import {
  DEFAULT_NPM_REGISTRY,
  MCP_PACKAGE,
  buildInstallArgs,
  npmCliCandidate,
  npxCacheDirFor,
  npxRefreshHint,
  packumentUrl,
  parseDistTags,
  resolveNpmRegistry,
  versionStatus,
} from "./npm-registry.js";

test("resolveNpmRegistry prefers the scoped IronWallet override", () => {
  assert.equal(
    resolveNpmRegistry({
      "npm_config_@ironwallet:registry": "https://nexus.example/repository/npm/",
      npm_config_registry: "https://registry.npmjs.org/",
    }),
    "https://nexus.example/repository/npm",
  );
});

test("resolveNpmRegistry falls back to npm_config_registry then npmjs", () => {
  assert.equal(
    resolveNpmRegistry({ npm_config_registry: "https://mirror.example/npm/" }),
    "https://mirror.example/npm",
  );
  assert.equal(resolveNpmRegistry({}), DEFAULT_NPM_REGISTRY);
});

test("packumentUrl encodes the scoped package name", () => {
  assert.equal(
    packumentUrl("https://registry.npmjs.org", MCP_PACKAGE),
    "https://registry.npmjs.org/@ironwallet%2fmcp-server",
  );
});

test("parseDistTags reads latest and extra tags", () => {
  assert.deepEqual(
    parseDistTags({
      "dist-tags": { latest: "1.1.0", preprod: "1.1.0-preprod.173" },
    }),
    { latest: "1.1.0", preprod: "1.1.0-preprod.173" },
  );
  assert.deepEqual(parseDistTags({}), {});
  assert.deepEqual(parseDistTags(null), {});
});

test("versionStatus compares running to published latest", () => {
  assert.deepEqual(versionStatus("1.1.0", "1.1.0"), {
    status: "current",
    updateAvailable: false,
  });
  assert.deepEqual(versionStatus("1.1.0", "1.2.0"), {
    status: "update_available",
    updateAvailable: true,
  });
  assert.deepEqual(versionStatus("1.1.0", undefined), {
    status: "unknown",
    updateAvailable: null,
  });
});

test("npxRefreshHint names the platform cache path", () => {
  assert.match(npxRefreshHint("win32"), /LOCALAPPDATA/);
  assert.match(npxRefreshHint("linux"), /\.npm\/_npx/);
});

test("npxCacheDirFor finds the _npx hash dir for a cache extract", () => {
  const hashDir = join("C:\\", "u", "npm-cache", "_npx", "bfd22b97d84f6345");
  const root = join(hashDir, "node_modules", "@ironwallet", "mcp-server");
  assert.equal(npxCacheDirFor(root), hashDir);
  assert.equal(npxCacheDirFor(root + "\\"), hashDir);
});

test("npxCacheDirFor rejects non-npx locations", () => {
  assert.equal(
    npxCacheDirFor(join("C:\\", "repo", "packages", "mcp-server")),
    null,
  );
  assert.equal(
    npxCacheDirFor(
      join("C:\\", "nvm", "node_modules", "@ironwallet", "mcp-server"),
    ),
    null,
  );
  assert.equal(
    npxCacheDirFor(join("C:\\", "u", "_npx", "hash", "node_modules", "@other", "mcp-server")),
    null,
  );
});

test("npmCliCandidate maps npx-cli.js to its sibling npm-cli.js", () => {
  const bin = join("C:\\", "nodejs", "node_modules", "npm", "bin");
  assert.equal(
    npmCliCandidate({ npm_execpath: join(bin, "npx-cli.js") }),
    join(bin, "npm-cli.js"),
  );
  assert.equal(
    npmCliCandidate({ npm_execpath: join(bin, "npm-cli.js") }),
    join(bin, "npm-cli.js"),
  );
  assert.equal(npmCliCandidate({ npm_execpath: join(bin, "pnpm.cjs") }), null);
  assert.equal(npmCliCandidate({}), null);
});

test("buildInstallArgs pins the exact version and stays quiet", () => {
  assert.deepEqual(buildInstallArgs("1.2.0"), [
    "install",
    `${MCP_PACKAGE}@1.2.0`,
    "--no-save",
    "--no-audit",
    "--no-fund",
    "--loglevel=error",
  ]);
});
