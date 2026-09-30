import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CandidateCatalog } from "../discovery/types.ts";
import { compileProfiles, loadProfiles } from "./profiles.ts";
import {
  bareName,
  chooseDelivery,
  loadFirstPartySightings,
  loadNativeRules,
  ruleKey,
  type NativeRule,
} from "./rules.ts";
import { UNSORTED } from "./taxonomy.ts";
import {
  REVIEW_ACTIONS,
  type Classification,
  type ClassificationCache,
  type ReviewAction,
  type ReviewEvent,
  type ReviewRule,
  type ReviewState,
  type ReviewStatus,
  type RuleReview,
  type Sighting,
} from "./types.ts";

/** Jev answers below these confidences leave the rule in the Unsorted bucket. */
const DOMAIN_CONFIDENCE_FLOOR = 0.5;
const CATEGORY_CONFIDENCE_FLOOR = 0.5;
const ECOSYSTEM_CONFIDENCE_FLOOR = 0.5;

const GENERIC_DESCRIPTION = /^Oxlint configuration enables or configures /;

export type ReviewPaths = {
  root: string;
  catalogPath: string;
  eventsPath: string;
  classificationPath: string;
  profilesDirectory: string;
  oxlintBinary: string;
};

export function reviewPaths(root: string): ReviewPaths {
  return {
    root,
    catalogPath: join(root, "discovery/candidates.json"),
    eventsPath: join(root, "review/events.jsonl"),
    classificationPath: join(root, "review/classification.json"),
    profilesDirectory: join(root, "profiles"),
    oxlintBinary: join(root, "node_modules/.bin/oxlint"),
  };
}

let nativeRulesPromise: Promise<Map<string, NativeRule>> | undefined;

export async function loadRules(
  paths: ReviewPaths,
): Promise<{ catalog: CandidateCatalog; rules: ReviewRule[] }> {
  nativeRulesPromise ??= loadNativeRules(paths.oxlintBinary);
  const [catalog, firstParty, nativeRules, oxlintRules] = await Promise.all([
    readJson<CandidateCatalog>(paths.catalogPath),
    loadFirstPartySightings(paths.root),
    nativeRulesPromise,
    readJson<{ rules: { [ruleId: string]: unknown } }>(join(paths.root, "oxlint/.oxlintrc.json")),
  ]);
  const groups = new Map<string, Sighting[]>();
  for (const sighting of [
    ...firstParty,
    ...catalog.candidates.map((candidate) => ({ ...candidate, origin: "upstream" as const })),
  ]) {
    const key = ruleKey(sighting);
    groups.set(key, [...(groups.get(key) ?? []), sighting]);
  }
  const rules = [...groups].map(([key, sightings]) =>
    groupRule(key, sightings, chooseDelivery(sightings, nativeRules, oxlintRules.rules)),
  );
  return { catalog, rules };
}

export async function loadReviewState(paths: ReviewPaths): Promise<ReviewState> {
  const [{ catalog, rules }, events, classification, profiles] = await Promise.all([
    loadRules(paths),
    loadEvents(paths.eventsPath),
    readJson<ClassificationCache>(paths.classificationPath).catch(() => undefined),
    loadProfiles(paths.profilesDirectory),
  ]);
  const latest = new Map<string, ReviewEvent>();
  for (const event of events) latest.set(event.ruleKey, event);

  const projected = rules.map((rule) => {
    const classified = classification?.rules[rule.key];
    return {
      ...rule,
      ...projectClassification(classified),
      review: projectReview(rule, latest.get(rule.key)),
    };
  });
  const compiled = compileProfiles(profiles, projected);
  for (const rule of projected) {
    rule.profiles = compiled
      .filter((profile) => rule.key in profile.resolved)
      .map(({ name }) => name);
  }
  projected.sort(
    (left, right) =>
      Number(right.review.status === "shipped") - Number(left.review.status === "shipped") ||
      left.name.localeCompare(right.name),
  );

  const count = (status: ReviewStatus) =>
    projected.filter(({ review }) => review.status === status).length;
  return {
    generatedAt: new Date().toISOString(),
    catalogGeneratedAt: catalog.generatedAt,
    ...(classification ? { classificationModel: classification.model } : {}),
    rules: projected,
    profiles: compiled,
    counts: {
      total: projected.length,
      unreviewed: count("unreviewed"),
      kept: count("kept"),
      deferred: count("deferred"),
      rejected: count("rejected"),
      shipped: count("shipped"),
    },
  };
}

function groupRule(
  key: string,
  sightings: Sighting[],
  delivery: ReviewRule["delivery"],
): ReviewRule {
  const primary = sightings[0];
  if (!primary) throw new Error(`Rule ${key} has no sightings`);
  const name =
    primary.artifact.kind === "agent-guidance"
      ? primary.name
      : bareName(primary.artifact.sourceRuleName ?? primary.name);
  const description =
    sightings.find(({ description }) => !GENERIC_DESCRIPTION.test(description))?.description ??
    primary.description;
  return {
    key,
    name,
    description,
    kinds: [...new Set(sightings.map(({ artifact }) => artifact.kind))],
    sources: [...new Set(sightings.map(({ source }) => source.repository))],
    sightings,
    revision: new Bun.CryptoHasher("sha256")
      .update(
        sightings
          .map(({ fingerprint }) => fingerprint)
          .sort()
          .join("\0"),
      )
      .digest("hex"),
    delivery,
    taxonomy: UNSORTED,
    ecosystem: "unsorted",
    classified: false,
    testCoverage: testCoverage(sightings),
    review: { status: "unreviewed", stale: false },
    profiles: [],
  };
}

function testCoverage(sightings: Sighting[]): ReviewRule["testCoverage"] {
  const dedicated = sightings.some(({ name, artifact }) => {
    const stem = name.replace(/^.*\//, "");
    return artifact.testPaths.some((path) => path.includes(stem));
  });
  if (dedicated) return "dedicated";
  return sightings.some(({ artifact }) => artifact.testPaths.length > 0) ? "linked" : "none";
}

function projectClassification(
  classification: Classification | undefined,
): Pick<ReviewRule, "taxonomy" | "ecosystem" | "projectSpecific" | "classified"> {
  if (!classification) return { taxonomy: UNSORTED, ecosystem: "unsorted", classified: false };
  const domainKnown = classification.confidence.domain >= DOMAIN_CONFIDENCE_FLOOR;
  const categoryKnown = classification.confidence.category >= CATEGORY_CONFIDENCE_FLOOR;
  return {
    taxonomy: domainKnown
      ? {
          domain: classification.domain,
          category: categoryKnown ? classification.category : UNSORTED.category,
        }
      : UNSORTED,
    ecosystem:
      classification.confidence.ecosystem >= ECOSYSTEM_CONFIDENCE_FLOOR
        ? classification.ecosystem
        : "unsorted",
    projectSpecific: classification.projectSpecific,
    classified: true,
  };
}

function projectReview(rule: ReviewRule, event: ReviewEvent | undefined): RuleReview {
  if (rule.delivery.kind === "first-party") return { status: "shipped", stale: false };
  if (!event || event.action === "reopen") return { status: "unreviewed", stale: false };
  const status: { [action in Exclude<ReviewAction, "reopen">]: ReviewStatus } = {
    keep: "kept",
    reject: "rejected",
    defer: "deferred",
  };
  return {
    status: status[event.action],
    rationale: event.rationale,
    updatedAt: event.createdAt,
    stale: event.revision !== rule.revision,
  };
}

export async function recordReviewEvent(
  paths: ReviewPaths,
  input: { ruleKey: string; action: string; rationale?: string },
): Promise<ReviewEvent> {
  const action = REVIEW_ACTIONS.find((candidate) => candidate === input.action);
  if (!action) throw new Error(`Invalid review action: ${input.action}`);
  const { rules } = await loadRules(paths);
  const rule = rules.find(({ key }) => key === input.ruleKey);
  if (!rule) throw new Error(`Unknown rule: ${input.ruleKey}`);
  if (rule.delivery.kind === "first-party") throw new Error("First-party rules already ship");

  const event: ReviewEvent = {
    eventId: crypto.randomUUID(),
    ruleKey: rule.key,
    revision: rule.revision,
    action,
    rationale: input.rationale?.trim() ?? "",
    createdAt: new Date().toISOString(),
  };
  await mkdir(dirname(paths.eventsPath), { recursive: true });
  await appendFile(paths.eventsPath, `${JSON.stringify(event)}\n`);
  return event;
}

export async function generateReviewOutputs(
  state: ReviewState,
  statePath: string,
  summaryPath: string,
): Promise<void> {
  await Promise.all([
    mkdir(dirname(statePath), { recursive: true }),
    mkdir(dirname(summaryPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`),
    writeFile(summaryPath, renderReviewSummary(state)),
  ]);
  await formatFiles([statePath, summaryPath]);
}

async function formatFiles(paths: string[]): Promise<void> {
  const formatter = join(import.meta.dir, "../../node_modules/.bin/oxfmt");
  const process = Bun.spawn([formatter, ...paths], { stdout: "pipe", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Failed to format review outputs: ${stderr.trim()}`);
}

export function renderReviewSummary(state: ReviewState): string {
  const sections = [
    ["Kept for evaluation", "kept"],
    ["Deferred", "deferred"],
    ["Rejected", "rejected"],
  ] as const;
  return `<!-- Generated by the local review app. Do not edit. -->

# Rule review summary

- Rules: ${state.counts.total}
- Shipped: ${state.counts.shipped}
- Unreviewed: ${state.counts.unreviewed}
- Kept: ${state.counts.kept}
- Deferred: ${state.counts.deferred}
- Rejected: ${state.counts.rejected}

## Profiles

${state.profiles
  .map(
    (profile) =>
      `- \`${profile.name}\`: ${Object.keys(profile.resolved).length} rules, ${profile.gaps.length} gaps. ${profile.description}`,
  )
  .join("\n")}

${sections
  .map(([heading, status]) => {
    const rules = state.rules.filter(({ review }) => review.status === status);
    return `## ${heading}

${
  rules.length === 0
    ? "_None._"
    : `| Rule | Sources | Semantic home | Rationale |\n| --- | --- | --- | --- |\n${rules
        .map(
          (rule) =>
            `| \`${rule.name}\` | ${rule.sources.join(", ")} | ${rule.taxonomy.domain} / ${rule.taxonomy.category} | ${escapeCell(rule.review.rationale ?? "")} |`,
        )
        .join("\n")}`
}`;
  })
  .join("\n\n")}
`;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function loadEvents(path: string): Promise<ReviewEvent[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ReviewEvent);
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
