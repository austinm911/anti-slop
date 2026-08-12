import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CandidateCatalog, RuleCandidate } from "../discovery/types.ts";
import { generateReviewOutputs, loadReviewState, recordReviewEvent } from "./project.ts";
import { classifyCandidate } from "./taxonomy.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("review projection", () => {
  test("keeps human decisions outside the generated candidate catalog", async () => {
    const root = await fixture();
    const catalogPath = join(root, "candidates.json");
    const eventsPath = join(root, "events.jsonl");
    const candidate = makeCandidate();
    await writeCatalog(catalogPath, [candidate]);

    await recordReviewEvent(catalogPath, eventsPath, {
      candidateId: candidate.id,
      action: "keep",
      rationale: "Strong portable type-safety rule.",
    });

    const state = await loadReviewState(catalogPath, eventsPath);
    expect(state.counts).toEqual({ total: 1, unreviewed: 0, kept: 1, decided: 0 });
    expect(state.candidates[0]?.review.action).toBe("keep");
    expect(state.candidates[0]?.review.rationale).toBe("Strong portable type-safety rule.");
    expect(
      JSON.parse(await readFile(catalogPath, "utf8")).candidates[0].admission.classification,
    ).toBe("unreviewed");
  });

  test("projects a later deep decision and generates review outputs", async () => {
    const root = await fixture();
    const catalogPath = join(root, "candidates.json");
    const eventsPath = join(root, "events.jsonl");
    const statePath = join(root, "state.json");
    const summaryPath = join(root, "summary.md");
    const candidate = makeCandidate();
    await writeCatalog(catalogPath, [candidate]);
    await recordReviewEvent(catalogPath, eventsPath, {
      candidateId: candidate.id,
      action: "keep",
    });
    await recordReviewEvent(catalogPath, eventsPath, {
      candidateId: candidate.id,
      action: "adapt",
      rationale: "Keep the concept but narrow the matching shape.",
    });

    const state = await loadReviewState(catalogPath, eventsPath);
    await generateReviewOutputs(state, statePath, summaryPath);
    expect(state.candidates[0]?.review.status).toBe("decided");
    expect(await readFile(summaryPath, "utf8")).toContain(
      "Keep the concept but narrow the matching shape.",
    );
    expect(JSON.parse(await readFile(statePath, "utf8")).counts.decided).toBe(1);
  });

  test("rejects invalid actions and classifies one semantic home", async () => {
    const root = await fixture();
    const catalogPath = join(root, "candidates.json");
    const candidate = makeCandidate();
    await writeCatalog(catalogPath, [candidate]);
    await expect(
      recordReviewEvent(catalogPath, join(root, "events.jsonl"), {
        candidateId: candidate.id,
        action: "ship-it",
      }),
    ).rejects.toThrow("Invalid review action");
    expect(classifyCandidate(candidate)).toEqual({
      domain: "Type & Data Contracts",
      category: "Type evidence & escape hatches",
    });
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anti-slop-review-test-"));
  temporaryDirectories.push(root);
  return root;
}

async function writeCatalog(path: string, candidates: RuleCandidate[]): Promise<void> {
  const catalog: CandidateCatalog = {
    schemaVersion: 1,
    generatedAt: "2026-08-12T00:00:00.000Z",
    sources: [{ repository: "fixture/repo", ref: "main", commit: "abc123" }],
    candidates,
  };
  await writeFile(path, `${JSON.stringify(catalog, null, 2)}\n`);
}

function makeCandidate(): RuleCandidate {
  return {
    id: "fixture--repo:no-chained-type-assertions:abc123",
    name: "no-chained-type-assertions",
    description: "Reject chained assertions that fabricate type evidence.",
    source: {
      repository: "fixture/repo",
      ref: "main",
      commit: "abc123",
      paths: ["src/rules/no-chained-type-assertions.ts"],
      license: "MIT",
    },
    artifact: {
      kind: "oxlint-plugin-rule",
      sourceRuleName: "no-chained-type-assertions",
      implementationPaths: ["src/rules/no-chained-type-assertions.ts"],
      testPaths: [],
    },
    fingerprint: "revision-1",
    admission: {
      classification: "unreviewed",
      failedConditions: ["No behavioral tests discovered."],
    },
    similarity: { exactDuplicates: [], relatedCandidates: [] },
  };
}
