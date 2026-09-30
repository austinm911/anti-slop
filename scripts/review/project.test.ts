import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(config.jsPlugins).toEqual(["./plugins/anti-slop.js"]);
    expect(config.rules["oxc/no-accumulating-spread"]).toBe("warn");
    expect(config.rules["anti-slop/no-effect-gen-arrow"]).toBe("warn");
    expect(config.rules["typescript/no-restricted-types"][0]).toBe("error");
    expect(effect?.astGrepRules).toEqual(["ast-grep/rules/no-commented-record-string-unknown.yml"]);
    expect(effect?.gaps.map(({ ruleKey }) => ruleKey)).toEqual(["rule:no-effect-gen-arrow"]);
    expect(effect?.install.commands).toContain("austinm911/anti-slop/effect");
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
    expect(await readFile(summaryPath, "utf8")).toContain("`effect`: 2 rules, 0 gaps.");
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

function makeCandidate(input: {
  repository: string;
  name: string;
  kind?: RuleCandidate["artifact"]["kind"];
}): RuleCandidate {
  const kind = input.kind ?? "oxlint-plugin-rule";
  const path = kind === "oxlint-policy" ? ".oxlintrc.json" : `src/rules/${input.name}.ts`;
  return {
    id: `${input.repository.replace("/", "--")}:${input.name}:abc123`,
    name: input.name,
    description: `Fixture rule ${input.name}.`,
    source: { repository: input.repository, ref: "main", commit: "abc1234def", paths: [path] },
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
