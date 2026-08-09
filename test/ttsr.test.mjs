import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rule = readFileSync(
  new URL("../omp/rules/no-record-string-unknown.md", import.meta.url),
  "utf8",
);
const conditionLine = rule.match(/^condition: (.+)$/m)?.[1];
if (!conditionLine) throw new Error("TTSR rule has no condition");
const condition = new RegExp(JSON.parse(conditionLine));

test("OMP TTSR catches Record<string, unknown> while it is written", () => {
  assert.match("type Raw = Record<string, unknown>", condition);
  assert.match("type Raw = Record < string,\nunknown >", condition);
  assert.match("type Raw = Record<string /* key */, unknown>", condition);
  assert.match("type Raw = Record<string // key\n, unknown>", condition);
});

test("OMP TTSR leaves stronger record types alone", () => {
  assert.doesNotMatch("type ById = Record<string, Payload>", condition);
  assert.doesNotMatch("type UnknownById = Record<number, unknown>", condition);
});
