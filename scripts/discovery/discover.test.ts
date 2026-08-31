import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifySimilarities,
  compareSourceUpdate,
  discoverDirectory,
  preserveSourceTransition,
} from "./discover.ts";
import {
  buildPrompt,
  excerptEvidence,
  mergeFailedConditions,
  parseAssessments,
  validateBatchAssessments,
} from "./enrich.ts";
import { renderCatalog } from "./report.ts";
import type { CandidateCatalog } from "./types.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("repository discovery", () => {
  test("discovers executable rules, tests, policy, and guidance without executing source code", async () => {
    const root = await fixture({
      "ast-grep/rules/no-forward.yml": `id: no-forward\nlanguage: TypeScript\nseverity: warning\nmessage: Return the value directly.\nrule:\n  pattern: return $A\n`,
      "ast-grep/rule-tests/no-forward-test.yml": `id: no-forward\nvalid:\n  - return value\ninvalid:\n  - return alias\n`,
      "src/rules/no-cast.ts": `export const noCast = { meta: { docs: { description: "Reject fabricated casts" }, messages: { bad: "Do not cast" } }, create(context) { return {}; } };`,
      "src/rules/no-cast.test.ts": `import { test } from "bun:test"; test("no cast", () => {});`,
      "rules/typed/src/workspace-rules/no-svg-files.ts": `export default { name: "no-svg-files", check: ({ report }) => report({ message: "No SVG files" }) };`,
      ".oxlintrc.json": JSON.stringify({
        rules: { "unicorn/no-useless-fallback-in-spread": "error" },
      }),
      ".antislop.jsonl": `${JSON.stringify({ id: "avoid-wrappers", text: "Avoid pass-through wrappers" })}\n`,
    });

    const candidates = await discoverDirectory(root, { repo: "fixture/repo", ref: "main" });
    expect(candidates.map(({ artifact }) => artifact.kind)).toEqual([
      "agent-guidance",
      "oxlint-plugin-rule",
      "ast-grep-rule",
      "workspace-check",
      "oxlint-policy",
    ]);

    const astGrep = candidates.find(({ name }) => name === "no-forward");
    expect(astGrep?.artifact.testPaths).toEqual(["ast-grep/rule-tests/no-forward-test.yml"]);
    expect(astGrep?.description).toBe("Return the value directly.");

    const plugin = candidates.find(({ name }) => name === "no-cast");
    expect(plugin?.artifact.testPaths).toEqual(["src/rules/no-cast.test.ts"]);
    expect(plugin?.admission.failedConditions).not.toContain("No behavioral tests discovered.");
    expect(candidates.find(({ name }) => name === "no-svg-files")?.artifact.kind).toBe(
      "workspace-check",
    );

    const policy = candidates.find(({ name }) => name === "unicorn/no-useless-fallback-in-spread");
    expect(policy?.admission.classification).toBe("native-policy");
    expect(policy?.admission.failedConditions).toContain(
      "Configured rule ownership and behavior have not been verified.",
    );
  });

  test("follows local config re-exports and extracts only configured rule keys", async () => {
    const root = await fixture({
      "oxlint.config.ts": `import config from './index.js';\nexport default config;`,
      "index.js": `export default defineConfig({
        helper: await import('./unrelated.js'),
        overrides: [{ files: ['**/*.ts'], rules: { 'no-console': 'off' } }],
        rules: {
          '@nkzw/no-instanceof': 'error',
          curly: 'error',
          eqeqeq: ['error', { null: 'ignore' }],
        },
      });`,
      "unrelated.js": `export default { rules: { 'not-oxlint-policy': true } };`,
    });

    const candidates = await discoverDirectory(root, { repo: "fixture/repo", ref: "main" });
    expect(candidates.map(({ name }) => name)).toEqual([
      "@nkzw/no-instanceof",
      "curly",
      "eqeqeq",
      "no-console",
    ]);
    expect(candidates[0]?.artifact.implementationPaths).toEqual(["oxlint.config.ts", "index.js"]);
    expect(candidates.some(({ name }) => name === "null")).toBeFalse();
    expect(candidates.some(({ name }) => name === "not-oxlint-policy")).toBeFalse();
  });

  test("merges the same policy from multiple configs without losing evidence", async () => {
    const root = await fixture({
      "oxlint.config.ts": `export default { rules: { 'no-console': 'error' } };`,
      "packages/app/oxlint.config.ts": `export default { rules: { 'no-console': 'off' } };`,
    });

    const candidates = await discoverDirectory(root, { repo: "fixture/repo", ref: "main" });
    const policies = candidates.filter(({ name }) => name === "no-console");
    expect(policies).toHaveLength(1);
    expect(policies[0]?.artifact.implementationPaths).toEqual([
      "oxlint.config.ts",
      "packages/app/oxlint.config.ts",
    ]);
    expect(policies[0]?.source.paths).toEqual([
      "oxlint.config.ts",
      "packages/app/oxlint.config.ts",
    ]);
  });

  test("extracts policy from YAML configs", async () => {
    const root = await fixture({
      ".oxlintrc.yaml": `rules:\n  no-console: error\n  unicorn/prefer-at: warn\n`,
    });

    const candidates = await discoverDirectory(root, { repo: "fixture/repo", ref: "main" });
    expect(candidates.map(({ name }) => name)).toEqual(["no-console", "unicorn/prefer-at"]);
  });

  test("links same-policy variants within a repository", async () => {
    const root = await fixture({
      "rules/no-cast.ts": `export default { meta: { description: "No casts" } };`,
      "copy/rules/no-cast.ts": `export default { meta: { description: "No casts" } };`,
      "rules/prefer-cast.ts": `export default { meta: { description: "Different implementation" } };`,
    });

    const candidates = await discoverDirectory(root, { repo: "fixture/repo", ref: "main" });
    const noCast = candidates.find(({ name }) => name === "no-cast");
    const preferCast = candidates.find(({ name }) => name === "prefer-cast");
    if (!noCast || !preferCast) throw new Error("Expected both cast candidates");
    expect(noCast.similarity.exactDuplicates).toHaveLength(0);
    expect(noCast.similarity.relatedCandidates).toEqual([preferCast.id]);
  });
  test("links shared suites by rule IDs in test content", async () => {
    const root = await fixture({
      "src/rules/no-shared.ts": `export default { meta: { description: "Shared suite rule" } };`,
      "test/rules.test.ts": `const ruleName = "no-shared";`,
    });
    const candidates = await discoverDirectory(root, { repo: "fixture/repo", ref: "main" });
    expect(candidates.find(({ name }) => name === "no-shared")?.artifact.testPaths).toEqual([
      "test/rules.test.ts",
    ]);
  });

  test("collects actionable canonical agent guidance", async () => {
    const root = await fixture({ "AGENTS.md": "- Never use `with` expressions.\n" });
    const candidates = await discoverDirectory(root, { repo: "fixture/repo", ref: "main" });
    expect(candidates[0]?.artifact.kind).toBe("agent-guidance");
    expect(candidates[0]?.description).toBe("Never use with expressions.");
    expect(candidates[0]?.name).toStartWith("guidance-never-use-with-expressions");
  });

  test("links identical implementations across repositories", async () => {
    const source = `export default { meta: { description: "No casts" } };`;
    const first = await fixture({ "rules/no-cast.ts": source });
    const second = await fixture({ "rules/no-cast.ts": source });
    const firstCandidates = await discoverDirectory(first, {
      repo: "fixture/first",
      ref: "main",
    });
    const secondCandidates = await discoverDirectory(second, {
      repo: "fixture/second",
      ref: "main",
    });
    const candidates = classifySimilarities([...firstCandidates, ...secondCandidates]);
    if (candidates.length !== 2) throw new Error("Expected two cross-repository candidates");
    const [firstCandidate, secondCandidate] = candidates;
    if (!firstCandidate || !secondCandidate) throw new Error("Expected both candidates");
    expect(firstCandidate.similarity.exactDuplicates).toEqual([secondCandidate.id]);
    expect(secondCandidate.similarity.exactDuplicates).toEqual([firstCandidate.id]);
  });
});

describe("agent enrichment contract", () => {
  test("builds bounded evidence packets and parses fenced JSON", async () => {
    const root = await fixture({
      "rules/no-cast.ts": `export default { meta: { description: "No casts" } };`,
    });
    const [candidate] = await discoverDirectory(root, { repo: "fixture/repo", ref: "main" });
    if (!candidate) throw new Error("Expected a discovered candidate");
    expect(buildPrompt([candidate], ["source evidence"])).toContain(candidate.id);

    const output = `\`\`\`json\n${JSON.stringify([
      {
        id: candidate.id,
        summary: "Reject unjustified casts.",
        defect: "The assertion fabricates type evidence.",
        remediation: "Construct or validate the target type.",
        applicability: ["TypeScript"],
        dependencies: [],
        exceptions: [],
        requiredAnalysis: "syntax",
        proposedOwner: "ast-grep",
        classification: "correctness-candidate",
        failedConditions: ["Repository scan evidence has not been recorded."],
        confidence: 0.8,
      },
    ])}\n\`\`\``;
    const [assessment] = parseAssessments(output);
    if (!assessment) throw new Error("Expected a parsed assessment");
    expect(assessment.classification).toBe("correctness-candidate");
    expect(() => validateBatchAssessments([candidate], [])).toThrow("Agent omitted candidate IDs");
    expect(mergeFailedConditions(candidate, assessment)).toContain(
      "Native Oxlint coverage has not been verified.",
    );
    expect(() =>
      parseAssessments(output.replace('"proposedOwner":"ast-grep"', '"proposedOwner":"oxlint"')),
    ).toThrow("assigns syntax analysis to oxlint");
    const lateEvidence = `${"prefix ".repeat(5_000)}${candidate.name} valid invalid counterexample`;
    expect(excerptEvidence(lateEvidence, candidate, 2_000)).toContain(
      `${candidate.name} valid invalid counterexample`,
    );
    expect(() =>
      parseAssessments(
        output
          .replace('"requiredAnalysis":"syntax"', '"requiredAnalysis":"type-information"')
          .replace('"proposedOwner":"ast-grep"', '"proposedOwner":"other"'),
      ),
    ).not.toThrow();
  });

  test("asks the agent to assess configured policy as adoption, not implementation", async () => {
    const root = await fixture({
      "oxlint.config.ts": `export default { rules: { 'no-console': 'error' } };`,
    });
    const [policy] = await discoverDirectory(root, { repo: "fixture/repo", ref: "main" });
    if (!policy) throw new Error("Expected policy candidate");
    const prompt = buildPrompt([policy], ["configured policy evidence"]);
    expect(prompt).toContain("adopt that existing policy");
    expect(prompt).toContain("not that the repository implements it");
    expect(prompt).toContain('"kind":"oxlint-policy"');
  });
});

describe("source refresh", () => {
  test("reports branch movement against the pinned catalog commit", () => {
    const previous: CandidateCatalog = {
      schemaVersion: 1,
      generatedAt: "2026-08-12T00:00:00.000Z",
      sources: [{ repository: "fixture/repo", ref: "main", commit: "old123" }],
      candidates: [],
    };
    expect(compareSourceUpdate({ repo: "fixture/repo", ref: "main" }, "new456", previous)).toEqual({
      repository: "fixture/repo",
      ref: "main",
      previousCommit: "old123",
      latestCommit: "new456",
      status: "updated",
    });
    expect(
      compareSourceUpdate({ repo: "fixture/new", ref: "main" }, "first", previous).status,
    ).toBe("new");
  });

  test("preserves the original transition after the refreshed commit is unchanged", () => {
    const previous: CandidateCatalog = {
      schemaVersion: 1,
      generatedAt: "2026-08-13T00:00:00.000Z",
      sources: [
        {
          repository: "fixture/repo",
          ref: "main",
          commit: "new456",
          previousCommit: "old123",
          updateStatus: "updated",
        },
      ],
      candidates: [],
    };
    const update = compareSourceUpdate({ repo: "fixture/repo", ref: "main" }, "new456", previous);
    expect(preserveSourceTransition(update, previous)).toEqual({
      repository: "fixture/repo",
      ref: "main",
      commit: "new456",
      previousCommit: "old123",
      updateStatus: "unchanged",
    });
  });

  test("records the immediately previous commit after another upstream update", () => {
    const previous: CandidateCatalog = {
      schemaVersion: 1,
      generatedAt: "2026-08-13T00:00:00.000Z",
      sources: [
        {
          repository: "fixture/repo",
          ref: "main",
          commit: "new456",
          previousCommit: "old123",
          updateStatus: "updated",
        },
      ],
      candidates: [],
    };
    const update = compareSourceUpdate(
      { repo: "fixture/repo", ref: "main" },
      "newest789",
      previous,
    );
    expect(preserveSourceTransition(update, previous).previousCommit).toBe("new456");
  });
});

describe("catalog report", () => {
  test("renders provenance and admission state", async () => {
    const root = await fixture({
      "rules/no-cast.ts": `export default { meta: { description: "No casts" } };`,
    });
    const candidates = await discoverDirectory(
      root,
      { repo: "fixture/repo", ref: "main" },
      "abc123",
    );
    const catalog: CandidateCatalog = {
      schemaVersion: 1,
      generatedAt: "2026-08-12T00:00:00.000Z",
      sources: [
        {
          repository: "fixture/repo",
          ref: "main",
          commit: "abc123",
          previousCommit: "old123",
          updateStatus: "updated",
        },
      ],
      candidates,
    };
    const report = renderCatalog(catalog);
    expect(report).toContain("# Discovery candidate catalog");
    expect(report).toContain("fixture/repo/blob/abc123/rules/no-cast.ts");
    expect(report).toContain("Repository scan evidence has not been recorded");
    expect(report).toContain("updated from `old123`");
  });
});

async function fixture(files: { [path: string]: string }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anti-slop-discovery-test-"));
  temporaryDirectories.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await writeFile(join(root, "package.json"), JSON.stringify({ license: "MIT" }));
  return root;
}
