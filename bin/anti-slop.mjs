#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(packageRoot, "ast-grep", "sgconfig.yml");
const preferencesConfigPath = join(packageRoot, "ast-grep", "sgconfig.preferences.yml");
const astGrepRoot = dirname(require.resolve("@ast-grep/cli/package.json"));
const astGrepBinary = join(astGrepRoot, process.platform === "win32" ? "ast-grep.exe" : "ast-grep");
const oxlintRoot = dirname(require.resolve("oxlint/package.json"));
const oxlintCli = join(oxlintRoot, "bin", "oxlint");
const oxlintConfigPath = join(packageRoot, "oxlint", ".oxlintrc.json");

const [command = "help", ...arguments_] = process.argv.slice(2);

function runCommand(binary, arguments_, name, options = {}) {
  const result = spawnSync(binary, arguments_, {
    cwd: options.cwd ?? process.cwd(),
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`anti-slop: failed to run ${name}: ${result.error.message}`);
    process.exit(1);
  }

  return result.status ?? 1;
}

switch (command) {
  case "scan": {
    const preferences = arguments_.includes("--preferences");
    const strict = arguments_.includes("--strict");
    if (preferences && strict) {
      console.error("anti-slop: --strict cannot be combined with --preferences");
      process.exit(2);
    }
    const paths = arguments_.filter(
      (argument) => argument !== "--preferences" && argument !== "--strict",
    );
    const targets = paths.length > 0 ? paths.map((target) => resolve(target)) : [process.cwd()];
    const selected = preferences ? preferencesConfigPath : configPath;
    const astGrepArguments = ["scan", "--config", selected];
    if (strict) astGrepArguments.push("--error=no-commented-record-string-unknown");
    astGrepArguments.push(...targets);
    const astGrep = runCommand(astGrepBinary, astGrepArguments, "ast-grep");
    if (preferences) process.exit(astGrep);

    const oxlintArguments = [oxlintCli, "--config", oxlintConfigPath];
    if (strict) oxlintArguments.push("--deny-warnings");
    oxlintArguments.push(...targets);
    const oxlint = runCommand(process.execPath, oxlintArguments, "oxlint");
    process.exit(astGrep === 0 && oxlint === 0 ? 0 : 1);
    break;
  }
  case "test": {
    const options = { cwd: packageRoot };
    const rules = runCommand(
      astGrepBinary,
      ["test", "--config", configPath, "--skip-snapshot-tests"],
      "ast-grep",
      options,
    );
    const preferences = runCommand(
      astGrepBinary,
      ["test", "--config", preferencesConfigPath, "--skip-snapshot-tests"],
      "ast-grep",
      options,
    );
    const oxlint = runCommand(
      process.execPath,
      [join(packageRoot, "oxlint", "test.mjs")],
      "Oxlint rule tests",
      options,
    );
    process.exit(rules === 0 && preferences === 0 && oxlint === 0 ? 0 : 1);
    break;
  }
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
  anti-slop scan --strict [paths...]
  anti-slop scan --preferences [paths...]
  anti-slop test
  anti-slop version`);
    break;
  default:
    console.error(`anti-slop: unknown command '${command}'`);
    process.exit(2);
}
