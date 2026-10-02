import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CandidateCatalog, RuleCandidate } from "../discovery/types.ts";
import { createProfile, setProfileRule } from "./profiles.ts";
import {
  generateReviewOutputs,
  loadReviewState,
  recordReviewEvent,
  reviewPaths,
  type ReviewPaths,
} from "./project.ts";
import type { ClassificationCache } from "./types.ts";

const repositoryRoot = resolve(import.meta.dir, "../..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("rule grouping", () => {
  test("merges sightings of one rule across sources and plugin scopes", async () => {
    const paths = await fixture([
      makeCandidate({ repository: "one/repo", name: "no-chained-type-assertions" }),
      makeCandidate({ repository: "two/repo", name: "no-chained-type-assertions" }),
      makeCandidate({
        repository: "one/repo",
        name: "typescript/no-explicit-any",
        kind: "oxlint-policy",
      }),
      makeCandidate({
        repository: "two/repo",
        name: "@typescript-eslint/no-explicit-any",
        kind: "oxlint-policy",
      }),
    ]);
    const state = await loadReviewState(paths);
    const chained = state.rules.find(({ key }) => key === "rule:no-chained-type-assertions");
    const explicitAny = state.rules.find(({ key }) => key === "rule:no-explicit-any");

    expect(chained?.sources).toEqual(["one/repo", "two/repo"]);
    expect(chained?.delivery.kind).toBe("vendor-oxlint");
    expect(explicitAny?.sightings).toHaveLength(2);
    expect(explicitAny?.delivery).toMatchObject({
      kind: "native",
      ruleId: "typescript/no-explicit-any",
    });
  });

  test("lists this repository's registry rules as shipped", async () => {
    const paths = await fixture([]);
    const state = await loadReviewState(paths);
    const shipped = state.rules.find(({ key }) => key === "rule:no-record-string-unknown");

    expect(shipped?.review.status).toBe("shipped");
    expect(shipped?.delivery).toMatchObject({
      kind: "first-party",
      tier: "correctness",
      astGrepRules: ["ast-grep/rules/no-commented-record-string-unknown.yml"],
    });
    await expect(
      recordReviewEvent(paths, { ruleKey: "rule:no-record-string-unknown", action: "reject" }),
    ).rejects.toThrow("First-party rules already ship");
  });
});

describe("review decisions", () => {
  test("keys decisions by rule and flags them when the rule changes upstream", async () => {
    const candidate = makeCandidate({ repository: "one/repo", name: "no-widen-then-assert" });
    const paths = await fixture([candidate]);
    await recordReviewEvent(paths, {
      ruleKey: "rule:no-widen-then-assert",
      action: "keep",
      rationale: "Portable type-safety rule.",
    });

    const kept = await loadReviewState(paths);
    const rule = kept.rules.find(({ key }) => key === "rule:no-widen-then-assert");
    expect(rule?.review).toMatchObject({ status: "kept", stale: false });
    expect(kept.counts.kept).toBe(1);

    // Upstream moves the file and edits the rule: the decision survives but is flagged.
    await writeCatalog(paths.catalogPath, [
      { ...candidate, id: "one--repo:moved:ffff", fingerprint: "revision-2" },
    ]);
    const changed = await loadReviewState(paths);
    expect(changed.rules.find(({ key }) => key === rule?.key)?.review).toMatchObject({
      status: "kept",
      stale: true,
    });
  });

  test("rejects unknown actions and rules", async () => {
    const paths = await fixture([makeCandidate({ repository: "one/repo", name: "no-foo" })]);
    await expect(
      recordReviewEvent(paths, { ruleKey: "rule:no-foo", action: "ship-it" }),
    ).rejects.toThrow("Invalid review action");
    await expect(
      recordReviewEvent(paths, { ruleKey: "rule:missing", action: "keep" }),
    ).rejects.toThrow("Unknown rule");
  });
});

describe("classification", () => {
  test("leaves low-confidence answers unsorted", async () => {
    const paths = await fixture([
      makeCandidate({ repository: "one/repo", name: "no-sure" }),
      makeCandidate({ repository: "one/repo", name: "no-guess" }),
    ]);
    const answer = {
      input: "hash",
      domain: "Type & Data Contracts",
      category: "Type evidence & escape hatches",
      ecosystem: "effect",
      projectSpecific: 0.1,
    } as const;
    const cache: ClassificationCache = {
      model: "jev-test",
      rules: {
        "rule:no-sure": { ...answer, confidence: { domain: 0.9, category: 0.8, ecosystem: 0.9 } },
        "rule:no-guess": { ...answer, confidence: { domain: 0.3, category: 0.8, ecosystem: 0.2 } },
      },
    };
    await writeFile(paths.classificationPath, JSON.stringify(cache));

    const state = await loadReviewState(paths);
    const sure = state.rules.find(({ key }) => key === "rule:no-sure");
    const guess = state.rules.find(({ key }) => key === "rule:no-guess");
    expect(sure?.taxonomy.domain).toBe("Type & Data Contracts");
    expect(sure?.ecosystem).toBe("effect");
    expect(guess?.taxonomy).toEqual({ domain: "Unsorted", category: "Unsorted" });
    expect(guess?.ecosystem).toBe("unsorted");
  });
});

describe("profiles", () => {
  test("compiles inherited rules into one Oxlint config and lists publishing gaps", async () => {
    const paths = await fixture([
      makeCandidate({ repository: "one/repo", name: "no-effect-gen-arrow" }),
      makeCandidate({
        repository: "one/repo",
        name: "oxc/no-accumulating-spread",
        kind: "oxlint-policy",
      }),
    ]);
    await createProfile(paths.profilesDirectory, {
      name: "base",
      description: "Base",
      extends: [],
    });
    await setProfileRule(paths.profilesDirectory, {
      profile: "base",
      ruleKey: "rule:no-record-string-unknown",
      severity: "error",
    });
    await createProfile(paths.profilesDirectory, {
      name: "effect",
      description: "Effect",
      extends: ["base"],
    });
    for (const ruleKey of ["rule:no-effect-gen-arrow", "rule:no-accumulating-spread"]) {
      await setProfileRule(paths.profilesDirectory, {
        profile: "effect",
        ruleKey,
        severity: "warn",
      });
    }

    const state = await loadReviewState(paths);
    const effect = state.profiles.find(({ name }) => name === "effect");
    const config = JSON.parse(effect?.oxlintConfig ?? "{}");
    expect(Object.keys(effect?.own ?? {})).toEqual([
      "rule:no-accumulating-spread",
      "rule:no-effect-gen-arrow",
    ]);
    expect(config.plugins).toEqual(["oxc", "typescript"]);
    expect(config.jsPlugins).toBeUndefined();
    expect(config.rules["oxc/no-accumulating-spread"]).toBe("warn");
    // A rule that still needs vendoring stays out of the config so the config always loads.
    expect(config.rules["anti-slop/no-effect-gen-arrow"]).toBeUndefined();
    expect(config.rules["typescript/no-restricted-types"][0]).toBe("error");
    expect(effect?.astGrepRules).toEqual(["ast-grep/rules/no-commented-record-string-unknown.yml"]);
    expect(effect?.astGrepConfigs).toEqual(["ast-grep/sgconfig.yml"]);
    expect(effect?.gaps.map(({ ruleKey }) => ruleKey)).toEqual([
      "rule:no-effect-gen-arrow",
      "ast-grep:ast-grep/sgconfig.yml",
    ]);
    expect(effect?.install.commands).toContain(
      "./node_modules/@austinm911/anti-slop/oxlint/configs/effect.json",
    );
    expect(
      state.rules.find(({ key }) => key === "rule:no-record-string-unknown")?.profiles,
    ).toEqual(["base", "effect"]);

    await setProfileRule(paths.profilesDirectory, {
      profile: "effect",
      ruleKey: "rule:no-effect-gen-arrow",
      severity: null,
    });
    const statePath = join(dirname(paths.catalogPath), "state.json");
    const summaryPath = join(dirname(paths.catalogPath), "summary.md");
    await generateReviewOutputs(await loadReviewState(paths), statePath, summaryPath);
    expect(await readFile(summaryPath, "utf8")).toContain("`effect`: 2 rules, 1 gaps.");
  });

  test("loads plugin rules through jsPlugins and carries the options upstream configures", async () => {
    const paths = await fixture([
      makeCandidate({ repository: "rayhanadev/oxray", name: "no-typeof" }),
      makeCandidate(
        { repository: "dmmulroy/anti-slop", name: "prefer-effect-match" },
        "src/effect/rules/prefer-effect-match.ts",
      ),
      makeCandidate({ repository: "unlicensed/repo", name: "no-switch" }, undefined, null),
      {
        ...makeCandidate({
          repository: "one/repo",
          name: "no-warning-comments",
          kind: "oxlint-policy",
        }),
        artifact: {
          kind: "oxlint-policy",
          sourceRuleName: "no-warning-comments",
          implementationPaths: [".oxlintrc.json"],
          testPaths: [],
          options: [{ terms: ["@nocommit"] }],
        },
      },
      {
        ...makeCandidate({ repository: "one/repo", name: "eqeqeq", kind: "oxlint-policy" }),
        artifact: {
          kind: "oxlint-policy",
          sourceRuleName: "eqeqeq",
          implementationPaths: [".oxlintrc.json"],
          testPaths: [],
          options: ["always"],
        },
      },
      {
        ...makeCandidate({ repository: "two/repo", name: "eqeqeq", kind: "oxlint-policy" }),
        artifact: {
          kind: "oxlint-policy",
          sourceRuleName: "eqeqeq",
          implementationPaths: [".oxlintrc.json"],
          testPaths: [],
          options: ["smart"],
        },
      },
    ]);
    await mkdir(paths.profilesDirectory, { recursive: true });
    await writeFile(
      join(paths.profilesDirectory, "base.json"),
      JSON.stringify({
        description: "",
        rules: {
          "rule:no-typeof": "error",
          "rule:prefer-effect-match": "warn",
          "rule:no-switch": "error",
          "rule:no-warning-comments": "warn",
          "rule:eqeqeq": "error",
          "rule:no-console": ["warn", { allow: ["error"] }],
        },
      }),
    );
    const state = await loadReviewState(paths);
    const base = state.profiles.find(({ name }) => name === "base");
    const config = JSON.parse(base?.oxlintConfig ?? "{}");

    expect(config.jsPlugins).toEqual([
      "../../dist/plugins/anti-slop-effect.js",
      "../../dist/plugins/rayhanadev.js",
    ]);
    expect(config.rules).toEqual({
      eqeqeq: "error",
      "anti-slop-effect/prefer-effect-match": "warn",
      "no-warning-comments": ["warn", { terms: ["@nocommit"] }],
      "rayhanadev/no-typeof": "error",
    });
    expect(base?.gaps).toEqual([
      {
        ruleKey: "rule:no-switch",
        reason: "unlicensed/repo has no license, so its implementation can't be redistributed.",
      },
      {
        ruleKey: "rule:eqeqeq",
        reason:
          "Sources configure different options (one/repo vs two/repo). Set them in the profile.",
      },
      { ruleKey: "rule:no-console", reason: "No longer in the discovery catalog." },
    ]);
    expect(base?.resolved["rule:no-console"]).toBe("warn");

    await setProfileRule(paths.profilesDirectory, {
      profile: "base",
      ruleKey: "rule:no-console",
      severity: "error",
    });
    const saved = JSON.parse(await readFile(join(paths.profilesDirectory, "base.json"), "utf8"));
    expect(saved.rules["rule:no-console"]).toEqual(["error", { allow: ["error"] }]);
  });

  test("inherits Oxlint categories and keeps the default plugins they need", async () => {
    const paths = await fixture([]);
    await mkdir(paths.profilesDirectory, { recursive: true });
    await writeFile(
      join(paths.profilesDirectory, "base.json"),
      JSON.stringify({ description: "", categories: { correctness: "error" }, rules: {} }),
    );
    await writeFile(
      join(paths.profilesDirectory, "strict.json"),
      JSON.stringify({
        description: "",
        extends: ["base"],
        categories: { pedantic: "warn" },
        rules: {},
      }),
    );
    const state = await loadReviewState(paths);
    const strict = state.profiles.find(({ name }) => name === "strict");
    const config = JSON.parse(strict?.oxlintConfig ?? "{}");
    expect(strict?.categories).toEqual({ correctness: "error", pedantic: "warn" });
    expect(config.categories).toMatchObject({
      correctness: "error",
      pedantic: "warn",
      style: "off",
    });
    expect(config.plugins).toEqual(["eslint", "oxc", "typescript", "unicorn"]);
  });

  test("refuses duplicate names, unknown bases, and bad names", async () => {
    const paths = await fixture([]);
    await createProfile(paths.profilesDirectory, { name: "base", description: "", extends: [] });
    await expect(
      createProfile(paths.profilesDirectory, { name: "base", description: "", extends: [] }),
    ).rejects.toThrow("already exists");
    await expect(
      createProfile(paths.profilesDirectory, { name: "x", description: "", extends: ["nope"] }),
    ).rejects.toThrow("Unknown base profile");
    await expect(
      createProfile(paths.profilesDirectory, { name: "Bad Name", description: "", extends: [] }),
    ).rejects.toThrow("lowercase");
  });
});

/**
 * Uses this repository's registry and Oxlint binary for first-party rules, with every
 * generated or human-authored file redirected to a temporary directory.
 */
async function fixture(candidates: RuleCandidate[]): Promise<ReviewPaths> {
  const directory = await mkdtemp(join(tmpdir(), "anti-slop-review-test-"));
  temporaryDirectories.push(directory);
  const paths: ReviewPaths = {
    ...reviewPaths(repositoryRoot),
    catalogPath: join(directory, "candidates.json"),
    eventsPath: join(directory, "events.jsonl"),
    classificationPath: join(directory, "classification.json"),
    profilesDirectory: join(directory, "profiles"),
  };
  await writeCatalog(paths.catalogPath, candidates);
  return paths;
}

async function writeCatalog(path: string, candidates: RuleCandidate[]): Promise<void> {
  const catalog: CandidateCatalog = {
    schemaVersion: 1,
    generatedAt: "2026-09-30T00:00:00.000Z",
    sources: [],
    candidates,
  };
  await writeFile(path, `${JSON.stringify(catalog, null, 2)}\n`);
}

function makeCandidate(
  input: {
    repository: string;
    name: string;
    kind?: RuleCandidate["artifact"]["kind"];
  },
  implementationPath?: string,
  license: string | null = "MIT",
): RuleCandidate {
  const kind = input.kind ?? "oxlint-plugin-rule";
  const path =
    implementationPath ??
    (kind === "oxlint-policy" ? ".oxlintrc.json" : `src/rules/${input.name}.ts`);
  return {
    id: `${input.repository.replace("/", "--")}:${input.name}:abc123`,
    name: input.name,
    description: `Fixture rule ${input.name}.`,
    source: {
      repository: input.repository,
      ref: "main",
      commit: "abc1234def",
      paths: [path],
      ...(license ? { license } : {}),
    },
    artifact: {
      kind,
      sourceRuleName: input.name,
      implementationPaths: [path],
      testPaths: kind === "oxlint-policy" ? [] : [`src/rules/${input.name}.test.ts`],
    },
    fingerprint: `${input.repository}:${input.name}`,
    admission: { classification: "unreviewed", failedConditions: [] },
    similarity: { exactDuplicates: [], relatedCandidates: [] },
  };
}
