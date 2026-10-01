#!/usr/bin/env node
// Checks that `oxlint` and `oxfmt` in this project can read `.tsrx`.
//
// `@tsrx/oxc` provides both commands. When the project also depends on `oxlint`
// or `oxfmt` directly, its commands hand every run to that dependency, which
// skips `.tsrx` files without failing. A stale install after a version bump
// reports every `.tsrx` file as wrong. Both look like source defects, so run this
// before lint and format.
//
// Usage: node tools/oxlint/check-tsrx-oxc.mjs [project-root]
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const problems = [];

const manifest = readJson(join(root, "package.json"));
const declared = (name) =>
  manifest.dependencies?.[name] ??
  manifest.devDependencies?.[name] ??
  manifest.optionalDependencies?.[name];

for (const name of ["oxlint", "oxfmt"]) {
  if (declared(name) !== undefined) {
    problems.push(
      `Remove the direct \`${name}\` dependency. \`@tsrx/oxc\` provides \`${name}\` and ` +
        `defers to a direct dependency, which skips every .tsrx file.`,
    );
  }
}

const spec = declared("@tsrx/oxc");
const enginePath = join(root, "node_modules/@tsrx/oxc/package.json");
if (spec === undefined) {
  problems.push("Add `@tsrx/oxc` as a devDependency, pinned to an exact version.");
} else if (!existsSync(enginePath)) {
  problems.push("`@tsrx/oxc` is declared but not installed. Run your package manager's install.");
} else {
  const engine = readJson(enginePath);
  const pinned = resolveCatalog("@tsrx/oxc", spec);
  if (pinned === undefined) {
    console.log(`Skipped the @tsrx/oxc pin check: cannot resolve \`${spec}\` from package.json.`);
  } else if (!/^\d+\.\d+\.\d+$/.test(pinned)) {
    problems.push(`Pin \`@tsrx/oxc\` to an exact version instead of \`${pinned}\`.`);
  } else if (engine.version !== pinned) {
    problems.push(
      `Installed @tsrx/oxc ${engine.version} does not match the pinned ${pinned}. ` +
        "Run your package manager's install.",
    );
  }

  // Plugins that import `@oxlint/plugins` type their rules against one Oxlint
  // release, so keep it on the release `@tsrx/oxc` runs.
  const bundled = engine.dependencies?.["oxlint-current"]?.replace(/^npm:oxlint@/, "");
  const pluginsPath = join(root, "node_modules/@oxlint/plugins/package.json");
  if (bundled !== undefined && existsSync(pluginsPath)) {
    const plugins = readJson(pluginsPath).version;
    if (plugins !== bundled) {
      problems.push(
        `@oxlint/plugins ${plugins} does not match oxlint ${bundled}, which @tsrx/oxc ` +
          `${engine.version} bundles. Pin @oxlint/plugins to ${bundled}.`,
      );
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log("oxlint and oxfmt read .tsrx through @tsrx/oxc.");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Resolves Bun and npm-style catalogs declared in package.json. */
function resolveCatalog(name, value) {
  const match = /^catalog:(.*)$/.exec(value);
  if (!match) return value;
  const catalogName = match[1].trim();
  const owners = [manifest, manifest.workspaces ?? {}];
  for (const owner of owners) {
    const catalog =
      catalogName === "" || catalogName === "default"
        ? owner.catalog
        : owner.catalogs?.[catalogName];
    if (catalog?.[name] !== undefined) return catalog[name];
  }
  return undefined;
}
