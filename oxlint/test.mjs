import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const directory = dirname(fileURLToPath(import.meta.url));
const config = join(directory, ".oxlintrc.json");
const oxlintRoot = dirname(require.resolve("oxlint/package.json"));
const oxlintCli = join(oxlintRoot, "bin", "oxlint");
const fixture = mkdtempSync(join(tmpdir(), "anti-slop-oxlint-"));

function run(file) {
  return spawnSync(process.execPath, [oxlintCli, "--config", config, file], {
    encoding: "utf8",
  });
}

try {
  const invalid = join(fixture, "invalid.ts");
  writeFileSync(
    invalid,
    [
      "export type RawPayload = Record<string, unknown>;",
      "export type SpacedPayload = Record < string, unknown >;",
      "export type MultilinePayload = Record<",
      "  string,",
      "  unknown",
      ">;",
      "export type NestedPayload = Readonly<Record<string, unknown>>;",
      "",
    ].join("\n"),
  );
  const reported = run(invalid);
  assert.equal(reported.status, 0, reported.stderr || reported.stdout);
  assert.equal(reported.stdout.match(/typescript\(no-restricted-types\)/g)?.length, 4);
  assert.match(reported.stdout, /strongly typed domain type/);
  assert.match(reported.stdout, /I\/O boundary/);

  const valid = join(fixture, "valid.ts");
  writeFileSync(
    valid,
    [
      "export interface Payload { id: string }",
      "export type PayloadsById = Record<string, Payload>;",
      "export type UnknownValueById = Record<number, unknown>;",
      "",
    ].join("\n"),
  );
  const accepted = run(valid);
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);

  console.log("PASS anti-slop/no-record-string-unknown");
} finally {
  rmSync(fixture, { recursive: true });
}
