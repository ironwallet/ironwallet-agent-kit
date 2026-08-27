#!/usr/bin/env node
"use strict";

const fs = require("fs");

const version = process.argv[2];
const file = process.argv[3] || "CHANGELOG.md";
if (!version) {
  console.error("usage: changelog-section.cjs <x.y.z> [CHANGELOG.md]");
  process.exit(2);
}

const text = fs.readFileSync(file, "utf8");
const prefix = `[${version}]`;
let section = "";
for (const part of text.split(/^## /m)) {
  if (part.startsWith(prefix)) {
    section = `## ${part}`;
    break;
  }
}
if (!section) {
  console.error("no changelog section for " + version);
  process.exit(1);
}

const linkRefs = section.search(/\n\[[^\]]+\]:/);
if (linkRefs !== -1) {
  section = section.slice(0, linkRefs);
}

process.stdout.write(section.trim() + "\n");
