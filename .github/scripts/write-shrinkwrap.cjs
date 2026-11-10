#!/usr/bin/env node
"use strict";

// npm-shrinkwrap.json for publish: package-lock.json minus dev-only entries.
// npm installs every entry of a dependency's shrinkwrap, dev ones included, so
// a plain copy would drag vite/esbuild/typescript into every npx install.

const fs = require("fs");
const path = require("path");

const dir = process.argv[2] || ".";
const lock = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
if (lock.lockfileVersion < 2 || !lock.packages) {
  console.error("package-lock.json must be lockfileVersion 2+");
  process.exit(1);
}

const packages = {};
let dropped = 0;
for (const [key, entry] of Object.entries(lock.packages)) {
  if (key === "") {
    const { devDependencies, ...root } = entry;
    packages[key] = { ...root, version: pkg.version };
  } else if (entry.dev) {
    dropped++;
  } else {
    packages[key] = entry;
  }
}

const shrinkwrap = { ...lock, version: pkg.version, packages };
fs.writeFileSync(path.join(dir, "npm-shrinkwrap.json"), `${JSON.stringify(shrinkwrap, null, 2)}\n`);
console.error(
  `npm-shrinkwrap.json: ${Object.keys(packages).length - 1} runtime packages, ${dropped} dev entries dropped`,
);
