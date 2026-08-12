#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import reviewApp from "../../review/index.html";
import type { CandidateCatalog, RuleCandidate } from "../discovery/types.ts";
import { generateReviewOutputs, loadReviewState, recordReviewEvent } from "./project.ts";

const root = resolve(import.meta.dir, "../..");
const catalogPath = join(root, "discovery/candidates.json");
const eventsPath = join(root, "review/events.jsonl");
const statePath = join(root, "review/state.json");
const summaryPath = join(root, "docs/generated/review-summary.md");
const cacheDirectory = join(root, "discovery/cache");
const port = Number.parseInt(process.env.REVIEW_PORT ?? "4317", 10);

const server = Bun.serve({
  port,
  routes: {
    "/": reviewApp,
    "/api/state": {
      GET: async () => Response.json(await refreshOutputs()),
    },
    "/api/review": {
      POST: async (request) => {
        try {
          const input = await request.json();
          if (!isObjectValue(input)) throw new Error("Review request must be an object");
          const candidateId = Reflect.get(input, "candidateId");
          const action = Reflect.get(input, "action");
          const rationale = Reflect.get(input, "rationale");
          const mergeTargetId = Reflect.get(input, "mergeTargetId");
          if (typeof candidateId !== "string" || typeof action !== "string") {
            throw new Error("Review request requires candidateId and action");
          }
          await recordReviewEvent(catalogPath, eventsPath, {
            candidateId,
            action,
            ...(typeof rationale === "string" ? { rationale } : {}),
            ...(typeof mergeTargetId === "string" ? { mergeTargetId } : {}),
          });
          return Response.json(await refreshOutputs());
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Review failed" },
            { status: 400 },
          );
        }
      },
    },
    "/api/evidence": {
      GET: async (request) => {
        const id = new URL(request.url).searchParams.get("id");
        if (!id) return Response.json({ error: "Missing candidate ID" }, { status: 400 });
        const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as CandidateCatalog;
        const candidate = catalog.candidates.find(({ id: candidateId }) => candidateId === id);
        if (!candidate) return Response.json({ error: "Candidate not found" }, { status: 404 });
        return Response.json(await readCandidateEvidence(candidate));
      },
    },
  },
  development: process.env.NODE_ENV !== "production",
});

console.log(`Rule review available at ${server.url}`);
if (!Bun.argv.includes("--no-open") && process.platform === "darwin") {
  Bun.spawn(["open", server.url.toString()]);
}

async function refreshOutputs() {
  const state = await loadReviewState(catalogPath, eventsPath);
  await generateReviewOutputs(state, statePath, summaryPath);
  return state;
}

async function readCandidateEvidence(candidate: RuleCandidate) {
  const checkout = join(cacheDirectory, candidate.source.repository.replace("/", "--"));
  const paths = [
    ...candidate.artifact.implementationPaths,
    ...candidate.artifact.testPaths,
    ...candidate.source.paths,
  ];
  const files = await Promise.all(
    [...new Set(paths)].slice(0, 8).map(async (path) => {
      try {
        const content = await readFile(join(checkout, path), "utf8");
        return { path, content: content.slice(0, 80_000), available: true };
      } catch {
        return { path, content: "", available: false };
      }
    }),
  );
  return { candidateId: candidate.id, files };
}

function isObjectValue(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
