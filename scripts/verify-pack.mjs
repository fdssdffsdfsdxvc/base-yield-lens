#!/usr/bin/env node
/**
 * Ensures npm pack ships the published bin entrypoints under dist/
 * (guards against regressing the package "files" field).
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const required = [
  "dist/cli.js",
  "dist/lib/fetch.js",
  "package.json",
  "LICENSE",
  "README.md",
];
const forbiddenPrefixes = ["src/", "tests/", "scripts/"];

const dir = mkdtempSync(join(tmpdir(), "base-yield-lens-pack-"));
try {
  const out = execSync(`npm pack --pack-destination ${JSON.stringify(dir)}`, {
    encoding: "utf8",
  });
  const line = out
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
  if (!line || !line.endsWith(".tgz")) {
    throw new Error(`unexpected npm pack output: ${out}`);
  }
  const tarball = join(dir, line);
  const listing = execSync(`tar -tzf ${JSON.stringify(tarball)}`, {
    encoding: "utf8",
  })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    // npm pack prefixes with package-name-version/
    .map((l) => l.replace(/^[^/]+\//, ""));

  for (const file of required) {
    if (!listing.includes(file)) {
      throw new Error(
        `pack missing required file: ${file}\n${listing.join("\n")}`,
      );
    }
  }
  for (const entry of listing) {
    if (
      forbiddenPrefixes.some(
        (p) => entry === p.slice(0, -1) || entry.startsWith(p),
      )
    ) {
      throw new Error(`pack unexpectedly includes ${entry}`);
    }
  }
  const extracted = execSync(
    `tar -xOf ${JSON.stringify(tarball)} package/package.json`,
    { encoding: "utf8" },
  );
  const pkg = JSON.parse(extracted);
  if (pkg.bin?.["base-yield-lens"] !== "./dist/cli.js") {
    throw new Error(
      `pack package.json bin must point at dist/cli.js: ${JSON.stringify(pkg.bin)}`,
    );
  }
  if (!Array.isArray(pkg.files) || !pkg.files.includes("dist")) {
    throw new Error(
      `pack package.json files must include "dist": ${JSON.stringify(pkg.files)}`,
    );
  }

  console.log("verify-pack: ok —", required.join(", "), "+ bin + files");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
