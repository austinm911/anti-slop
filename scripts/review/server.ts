#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import reviewApp from "../../review/index.html";
import { createProfile, setProfileRule } from "./profiles.ts";
import {
  generateReviewOutputs,
  loadReviewState,
  loadRules,
  recordReviewEvent,
  reviewPaths,
} from "./project.ts";
import { FIRST_PARTY_REPOSITORY } from "./rules.ts";
import { SEVERITIES, type ReviewRule } from "./types.ts";

const root = resolve(import.meta.dir, "../..");
const paths = reviewPaths(root);
const statePath = join(root, "review/state.json");
const summaryPath = join(root, "docs/generated/review-summary.md");
const cacheDirectory = join(root, "discovery/cache");
// `portless` exports PORT and PORTLESS_URL; the fallback keeps a bare server run working.
const port = Number.parseInt(process.env.PORT ?? "4317", 10);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  routes: {
    "/": reviewApp,
    "/api/state": {
      GET: async () => Response.json(await refreshOutputs()),
    },
    "/api/review": {
      POST: (request) =>
        mutate(request, async (input) => {
          const ruleKey = input.get("ruleKey");
          const action = input.get("action");
          const rationale = input.get("rationale");
          if (typeof ruleKey !== "string" || typeof action !== "string") {
            throw new Error("Review request requires ruleKey and action");
          }
          await recordReviewEvent(paths, {
            ruleKey,
            action,
            ...(typeof rationale === "string" ? { rationale } : {}),
          });
        }),
    },
    "/api/profiles": {
      POST: (request) =>
        mutate(request, async (input) => {
          const name = input.get("name");
          const description = input.get("description");
          const bases = input.get("extends");
          if (typeof name !== "string") throw new Error("Profile request requires a name");
          await createProfile(paths.profilesDirectory, {
            name,
            description: typeof description === "string" ? description : "",
            extends: Array.isArray(bases)
              ? bases.filter((base): base is string => typeof base === "string")
              : [],
          });
        }),
    },
    "/api/profile-rule": {
      POST: (request) =>
        mutate(request, async (input) => {
          const profile = input.get("profile");
          const ruleKey = input.get("ruleKey");
          const severity = input.get("severity");
          if (typeof profile !== "string" || typeof ruleKey !== "string") {
            throw new Error("Profile rule request requires profile and ruleKey");
          }
          const level = SEVERITIES.find((candidate) => candidate === severity);
          if (severity !== null && !level) throw new Error(`Invalid severity: ${String(severity)}`);
          await setProfileRule(paths.profilesDirectory, {
            profile,
            ruleKey,
            severity: level ?? null,
          });
        }),
    },
    "/api/evidence": {
      GET: async (request) => {
        const key = new URL(request.url).searchParams.get("key");
        if (!key) return Response.json({ error: "Missing rule key" }, { status: 400 });
        const { rules } = await loadRules(paths);
        const rule = rules.find((candidate) => candidate.key === key);
        if (!rule) return Response.json({ error: "Rule not found" }, { status: 404 });
        return Response.json(await readRuleEvidence(rule));
      },
    },
  },
  development: process.env.NODE_ENV !== "production",
});

const url = process.env.PORTLESS_URL ?? server.url.toString();
console.log(`Rule review available at ${url}`);
if (!Bun.argv.includes("--no-open") && process.platform === "darwin") {
  Bun.spawn(["open", url]);
}

async function refreshOutputs() {
  const state = await loadReviewState(paths);
  await generateReviewOutputs(state, statePath, summaryPath);
  return state;
}

/** Applies one write and answers with the refreshed state so the client never re-fetches. */
async function mutate(
  request: Request,
  apply: (input: Map<string, unknown>) => Promise<void>,
): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("Request body must be an object");
    }
    await apply(new Map(Object.entries(body)));
    return Response.json(await refreshOutputs());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 400 },
    );
  }
}

async function readRuleEvidence(rule: ReviewRule) {
  const files = rule.sightings.flatMap((sighting) => {
    const base =
      sighting.origin === "first-party"
        ? root
        : join(cacheDirectory, sighting.source.repository.replace("/", "--"));
    return [
      ...new Set([
        ...sighting.artifact.implementationPaths,
        ...sighting.artifact.testPaths,
        ...sighting.source.paths,
      ]),
    ].map((path) => ({
      repository:
        sighting.origin === "first-party" ? FIRST_PARTY_REPOSITORY : sighting.source.repository,
      commit: sighting.source.commit,
      path,
      absolute: join(base, path),
    }));
  });
  return {
    ruleKey: rule.key,
    files: await Promise.all(
      files.slice(0, 12).map(async ({ absolute, ...file }) => {
        try {
          const content = await readFile(absolute, "utf8");
          return { ...file, content: content.slice(0, 80_000), available: true };
        } catch {
          return { ...file, content: "", available: false };
        }
      }),
    ),
  };
}
