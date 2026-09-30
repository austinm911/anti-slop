import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AUTHORED_DIRECTORY, parseAuthoredExamples, type AuthoredExamples } from "./examples.ts";
import { loadRules, reviewPaths } from "./project.ts";
import { bareName } from "./rules.ts";
import type { ReviewRule, RuleExample } from "./types.ts";

const root = resolve(import.meta.dir, "../..");
const paths = reviewPaths(root);
const directory = join(root, AUTHORED_DIRECTORY);
const files = (await readdir(directory).catch(() => [])).filter((name) => name.endsWith(".yml"));
const { rules } = await loadRules(paths);
const rulesByKey = new Map(rules.map((rule) => [rule.key, rule]));
const typeAware = new Set(
  (
    JSON.parse(await Bun.$`${paths.oxlintBinary} --rules --format=json`.text()) as Array<{
      scope: string;
      value: string;
      type_aware: boolean;
    }>
  )
    .filter(({ type_aware }) => type_aware)
    .map(({ value }) => value),
);
/** A malformed file fails its own test instead of the whole suite. */
const authored = await Promise.all(
  files.map(async (name) => {
    const path = join(directory, name);
    const content = await readFile(path, "utf8");
    try {
      return { name, examples: parseAuthoredExamples(content, path), error: undefined };
    } catch (error) {
      return { name, examples: undefined, error };
    }
  }),
);

describe("authored examples", () => {
  test.each(authored)(
    "$name names a catalog rule and matches its file name",
    ({ name, examples, error }) => {
      if (!examples) throw error;
      expect(rulesByKey.has(examples.rule)).toBe(true);
      expect(`${examples.rule.replace(/^rule:/, "")}.yml`).toBe(name);
    },
  );

  const native = authored.flatMap(({ name, examples }) => {
    if (!examples) return [];
    const rule = rulesByKey.get(examples.rule);
    if (rule?.delivery.kind !== "native" || examples.verify === false) return [];
    if (typeAware.has(bareName(rule.delivery.ruleId))) return [];
    return [{ name, examples, rule }];
  });

  test.concurrent.each(native)(
    "$name: Oxlint reports every break and accepts every fix and pass",
    async ({ examples, rule }) => {
      expect(await findings(rule, examples)).toEqual({
        breaks: examples.breaks.map(() => true),
        fixed: examples.breaks.map(() => false),
        passes: examples.passes.map(() => false),
      });
    },
  );
});

/** Lints each snippet as its own file with only this rule enabled. */
async function findings(rule: ReviewRule, examples: AuthoredExamples) {
  if (rule.delivery.kind !== "native") throw new Error(`${rule.key} is not native`);
  const workspace = await mkdtemp(join(tmpdir(), "anti-slop-example-"));
  try {
    const groups = {
      breaks: examples.breaks,
      fixed: examples.breaks.map(
        ({ fixed, filename }): RuleExample => ({
          code: fixed ?? "",
          ...(filename ? { filename } : {}),
        }),
      ),
      passes: examples.passes,
    };
    const written = await Promise.all(
      Object.entries(groups).flatMap(([group, list]) =>
        list.map(async (example, index) => {
          const folder = join(workspace, `${group}-${index}`);
          await mkdir(folder, { recursive: true });
          const path = join(folder, example.filename ?? "example.tsx");
          await writeFile(path, `${example.code}\n`);
          return { group, index, path };
        }),
      ),
    );
    const config = join(workspace, ".oxlintrc.json");
    await writeFile(
      config,
      JSON.stringify({
        plugins: rule.delivery.plugin === "eslint" ? [] : [rule.delivery.plugin],
        categories: { correctness: "off" },
        rules: { [rule.delivery.ruleId]: "error" },
      }),
    );
    const process = Bun.spawn(
      [paths.oxlintBinary, "--config", config, "--format=unix", ...written.map(({ path }) => path)],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(process.stdout).text();
    await process.exited;
    const marker = `(${bareName(rule.delivery.ruleId)})]`;
    const reported = new Set(
      output
        .split("\n")
        .filter((line) => line.endsWith(marker))
        .map((line) => resolve(line.slice(0, line.indexOf(":")))),
    );
    const result: { breaks: boolean[]; fixed: boolean[]; passes: boolean[] } = {
      breaks: [],
      fixed: [],
      passes: [],
    };
    for (const { group, path } of written) {
      if (group === "breaks" || group === "fixed" || group === "passes") {
        result[group].push(reported.has(resolve(path)));
      }
    }
    return result;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
