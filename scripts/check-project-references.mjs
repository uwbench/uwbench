// Every workspace package that compiles must be listed in the root tsconfig's
// project references. `tsc --build` cannot catch a missing one: an unreferenced
// package is simply never built, so the root typecheck passes while the package
// silently drops out of the build graph. T16 and T17 both shipped that way.

import { readdirSync, readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal pnpm-workspace.yaml reader: the file is a flat list of globs, so a
// YAML dependency would not earn its keep here.
function workspaceGlobs() {
  const file = join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) return ["packages/*", "apps/*", "examples/*"];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.match(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/))
    .filter(Boolean)
    .map((match) => match[1]);
}

function compilablePackages() {
  const found = [];
  for (const glob of workspaceGlobs()) {
    if (!glob.endsWith("/*")) continue;
    const parent = join(root, glob.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = `${glob.slice(0, -2)}/${entry.name}`;
      if (existsSync(join(root, rel, "tsconfig.json"))) found.push(rel);
    }
  }
  return found.sort();
}

const normalize = (path) => path.replace(/^\.\//, "").replace(/\/$/, "");

const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
const referenced = new Set(
  (tsconfig.references ?? []).map((reference) => normalize(reference.path)),
);
const packages = compilablePackages();

const missing = packages.filter((pkg) => !referenced.has(pkg));
const stale = [...referenced].filter(
  (ref) => !existsSync(join(root, ref, "tsconfig.json")),
);

if (missing.length === 0 && stale.length === 0) {
  console.log(
    `✅ Root tsconfig references all ${packages.length} compilable workspace packages`,
  );
  process.exit(0);
}

for (const pkg of missing) {
  console.error(
    `❌ ${pkg} has a tsconfig.json but is not in the root tsconfig references`,
  );
}
for (const ref of stale) {
  console.error(
    `❌ Root tsconfig references ${ref}, which has no tsconfig.json`,
  );
}
console.error(
  `\nAdd { "path": "./<package>" } to "references" in tsconfig.json for each missing package.`,
);
process.exit(1);
