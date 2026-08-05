#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(packageRoot, "ast-grep", "sgconfig.yml");
const astGrepRoot = dirname(require.resolve("@ast-grep/cli/package.json"));
const astGrepBinary = join(astGrepRoot, process.platform === "win32" ? "ast-grep.exe" : "ast-grep");

const [command = "help", ...arguments_] = process.argv.slice(2);

function runAstGrep(arguments_, options = {}) {
  const result = spawnSync(astGrepBinary, arguments_, {
    cwd: options.cwd ?? process.cwd(),
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`anti-slop: failed to run ast-grep: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

switch (command) {
  case "scan": {
    const targets =
      arguments_.length > 0 ? arguments_.map((target) => resolve(target)) : [process.cwd()];
    runAstGrep(["scan", "--config", configPath, ...targets]);
    break;
  }
  case "test":
    runAstGrep(["test", "--config", configPath, "--skip-snapshot-tests"], { cwd: packageRoot });
    break;
  case "version": {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    console.log(packageJson.version);
    break;
  }
  case "help":
  case "--help":
  case "-h":
    console.log(`anti-slop

Usage:
  anti-slop scan [paths...]
  anti-slop test
  anti-slop version`);
    break;
  default:
    console.error(`anti-slop: unknown command '${command}'`);
    process.exit(2);
}
