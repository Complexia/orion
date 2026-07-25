// Manually update the vendored Rift (rift-snapshot) to the latest published version.
//
// Rift is pinned to an exact version in package.json so it never updates on its
// own. Run `bun run update-rifts` when you want to pull in the latest release.
// Repo / release notes: https://github.com/anomalyco/rift/releases

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = path.join(root, "package.json");

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const current = pkg.dependencies?.["rift-snapshot"];
if (!current) {
  console.error("rift-snapshot is not listed in dependencies; nothing to update.");
  process.exit(1);
}

console.log(`Current rift-snapshot: ${current}`);
console.log("Checking npm for the latest release...");

const latest = execFileSync("npm", ["view", "rift-snapshot", "version"], {
  encoding: "utf8",
}).trim();

if (latest === current) {
  console.log(`Already up to date (${current}).`);
  process.exit(0);
}

console.log(`Updating rift-snapshot ${current} -> ${latest}`);
pkg.dependencies["rift-snapshot"] = latest;
fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");

execFileSync("bun", ["install"], { cwd: root, stdio: "inherit" });
execFileSync(
  "npm",
  ["install", "--package-lock-only", "--ignore-scripts"],
  { cwd: root, stdio: "inherit" }
);

// Smoke-test the freshly installed prebuilt binary for this platform.
const platform = { darwin: "darwin", linux: "linux", win32: "windows" }[os.platform()];
const arch = { arm64: "arm64", x64: "x64" }[os.arch()];
const binary = path.join(
  root,
  "node_modules",
  "rift-snapshot",
  "prebuilds",
  `${platform}-${arch}`,
  platform === "windows" ? "rift.exe" : "rift"
);
const check = spawnSync(binary, ["--help"], { encoding: "utf8" });
if (check.status !== 0) {
  console.error(`Smoke test failed: ${binary} --help exited with ${check.status}`);
  console.error(check.stderr || check.error?.message || "");
  console.error(
    "Reverting is manual: git checkout package.json bun.lock package-lock.json && bun install"
  );
  process.exit(1);
}

console.log(`\nrift-snapshot updated to ${latest} and the ${platform}-${arch} binary works.`);
console.log(`Release notes: https://github.com/anomalyco/rift/releases`);
console.log("Review the diff and commit package.json + bun.lock + package-lock.json.");
