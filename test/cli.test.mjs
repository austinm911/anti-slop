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

test("scan reports Record<string, unknown> with boundary guidance", () => {
  const directory = mkdtempSync(join(tmpdir(), "anti-slop-record-"));

  try {
    writeFileSync(
      join(directory, "invalid.ts"),
      "export type RawPayload = Record<string, unknown>;\n",
    );
    const result = run("scan", directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /typescript\(no-restricted-types\)/);
    assert.match(result.stdout, /strongly typed domain type/);
    assert.match(result.stdout, /I\/O boundary/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("scan reports a comment-formatted Record<string, unknown>", () => {
  const directory = mkdtempSync(join(tmpdir(), "anti-slop-record-comment-"));

  try {
    writeFileSync(
      join(directory, "invalid.ts"),
      "export type RawPayload = Record<string /* key */, unknown>;\n",
    );
    const result = run("scan", directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /no-commented-record-string-unknown/);
    assert.match(result.stdout, /strongly typed domain type/);
    assert.match(result.stdout, /I\/O boundary/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("scan --strict bans normal and comment-formatted records", () => {
  const directory = mkdtempSync(join(tmpdir(), "anti-slop-record-strict-"));

  try {
    writeFileSync(
      join(directory, "invalid.ts"),
      [
        "export type RawPayload = Record<string, unknown>;",
        "export type CommentedPayload = Record<string /* key */, unknown>;",
        "",
      ].join("\n"),
    );
    const result = run("scan", "--strict", directory);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /typescript\(no-restricted-types\)/);
    assert.match(result.stdout, /no-commented-record-string-unknown/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("scan accepts a parsed domain type", () => {
  const directory = mkdtempSync(join(tmpdir(), "anti-slop-domain-"));

  try {
    writeFileSync(
      join(directory, "valid.ts"),
      "export interface Payload { id: string }\nexport function use(value: Payload) { return value.id }\n",
    );
    const result = run("scan", directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("the default scan ignores preferences", () => {
  const directory = mkdtempSync(join(tmpdir(), "anti-slop-preference-"));

  try {
    writeFileSync(
      join(directory, "mixed.ts"),
      "/**\n  Modes:\n  * fast\n */\nexport const a = 1\n",
    );
    const result = run("scan", directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout, /no-mixed-jsdoc-line-prefix/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("scan --preferences reports a mixed JSDoc prefix", () => {
  const directory = mkdtempSync(join(tmpdir(), "anti-slop-preference-"));

  try {
    writeFileSync(
      join(directory, "mixed.ts"),
      "/**\n  Modes:\n  * fast\n */\nexport const a = 1\n",
    );
    const result = run("scan", "--preferences", directory);
    assert.match(result.stdout, /no-mixed-jsdoc-line-prefix/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("scan --preferences ignores correctness rules", () => {
  const directory = mkdtempSync(join(tmpdir(), "anti-slop-preference-"));

  try {
    writeFileSync(
      join(directory, "clean.ts"),
      "/**\n  Modes:\n  - fast\n */\nexport type Raw = Record<string, unknown>\n",
    );
    const result = run("scan", "--preferences", directory);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("scan rejects incompatible strict and preference tiers", () => {
  const result = run("scan", "--strict", "--preferences");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot be combined/);
});

test("unknown commands are usage errors", () => {
  const result = run("wat");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown command/);
});
