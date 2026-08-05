import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const cli = new URL("../bin/anti-slop.mjs", import.meta.url).pathname;

function run(...arguments_) {
  return spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });
}

test("packaged rule tests pass", () => {
  const result = run("test");
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("scan rejects an immediate-return local alias", () => {
  const directory = mkdtempSync(join(tmpdir(), "anti-slop-invalid-"));

  try {
    writeFileSync(
      join(directory, "invalid.ts"),
      "function load() { const value = fetchValue(); return value }\n",
    );
    const result = run("scan", directory);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /no-return-local-alias-function/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("scan accepts a direct return", () => {
  const directory = mkdtempSync(join(tmpdir(), "anti-slop-valid-"));

  try {
    writeFileSync(join(directory, "valid.ts"), "function load() { return fetchValue() }\n");
    const result = run("scan", directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("unknown commands are usage errors", () => {
  const result = run("wat");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown command/);
});
