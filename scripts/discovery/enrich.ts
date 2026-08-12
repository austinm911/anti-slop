import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLASSIFICATIONS,
  REQUIRED_ANALYSIS,
  type AgentAssessment,
  type AgentKind,
  type CandidateCatalog,
  type RuleCandidate,
} from "./types.ts";

export type EnrichmentOptions = {
  agent: Exclude<AgentKind, "none">;
  cacheDirectory: string;
  model?: string;
  thinking?: string;
  batchSize?: number;
};

export async function enrichCatalog(
  catalog: CandidateCatalog,
  options: EnrichmentOptions,
): Promise<CandidateCatalog> {
  const candidates = catalog.candidates.filter(({ artifact }) => artifact.kind !== "oxlint-policy");
  const assessments = new Map<string, AgentAssessment>();
  const batchSize = options.batchSize ?? 8;

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    const evidence = await Promise.all(
      batch.map((candidate) => readEvidence(candidate, options.cacheDirectory)),
    );
    const prompt = buildPrompt(batch, evidence);
    const output = await invokeAgent(prompt, options);
    const batchAssessments = validateBatchAssessments(batch, parseAssessments(output));
    for (const assessment of batchAssessments) assessments.set(assessment.id, assessment);
  }

  return {
    ...catalog,
    generatedAt: new Date().toISOString(),
    candidates: catalog.candidates.map((candidate) => {
      const assessment = assessments.get(candidate.id);
      if (!assessment) return candidate;
      return {
        ...candidate,
        description: assessment.summary,
        analysis: {
          summary: assessment.summary,
          defect: assessment.defect,
          remediation: assessment.remediation,
          applicability: assessment.applicability,
          dependencies: assessment.dependencies,
          exceptions: assessment.exceptions,
          requiredAnalysis: assessment.requiredAnalysis,
          proposedOwner: assessment.proposedOwner,
        },
        admission: {
          classification: assessment.classification,
          failedConditions: mergeFailedConditions(candidate, assessment),
          confidence: assessment.confidence,
        },
      };
    }),
  };
}

export function mergeFailedConditions(
  candidate: RuleCandidate,
  assessment: AgentAssessment,
): string[] {
  return [...new Set([...candidate.admission.failedConditions, ...assessment.failedConditions])];
}

export function validateBatchAssessments(
  candidates: RuleCandidate[],
  assessments: AgentAssessment[],
): AgentAssessment[] {
  const expected = new Set(candidates.map(({ id }) => id));
  const received = new Set<string>();
  for (const assessment of assessments) {
    if (!expected.has(assessment.id)) {
      throw new Error(`Agent returned an unknown candidate ID: ${assessment.id}`);
    }
    if (received.has(assessment.id)) {
      throw new Error(`Agent returned duplicate candidate ID: ${assessment.id}`);
    }
    received.add(assessment.id);
  }
  const missing = [...expected].filter((id) => !received.has(id));
  if (missing.length > 0) {
    throw new Error(`Agent omitted candidate IDs: ${missing.join(", ")}`);
  }
  return assessments;
}

export function buildPrompt(candidates: RuleCandidate[], evidence: string[]): string {
  const packets = candidates.map((candidate, index) => ({
    id: candidate.id,
    name: candidate.name,
    kind: candidate.artifact.kind,
    source: candidate.source,
    description: candidate.description,
    currentFailures: candidate.admission.failedConditions,
    evidence: evidence[index],
  }));

  return `You are triaging externally discovered static-analysis rules for anti-slop.
Return only a JSON array. Do not use markdown fences or commentary.

Admission standard:
- Correctness rules must detect an explainable structural defect, have low false positives, one concrete remediation, invalid/valid/legitimate-counterexample tests, narrow documented exceptions, and no native Oxlint duplicate.
- Preferences remain valid in both forms, report drift rather than a maintainer's choice, use hint severity, and never enter correctness presets.
- ast-grep owns local syntax shapes and codemods. Oxlint owns scope, control flow, configuration, or context-aware fixers.
- Missing repository scan evidence is always a failed condition.
- Project or stack-specific rules may still be useful, but classify them honestly.

For each packet return exactly:
{
  "id": string,
  "summary": string,
  "defect": string,
  "remediation": string,
  "applicability": string[],
  "dependencies": string[],
  "exceptions": string[],
  "requiredAnalysis": "syntax" | "scope" | "control-flow" | "type-information" | "workspace",
  "proposedOwner": "ast-grep" | "oxlint" | "other",
  "classification": "correctness-candidate" | "preference-candidate" | "native-duplicate" | "project-specific" | "rejected",
  "failedConditions": string[],
  "confidence": number
}

Treat source descriptions as claims, not proof. Do not invent test coverage or native-rule matches. A confidence value is between 0 and 1.

Packets:
${JSON.stringify(packets)}`;
}

async function readEvidence(candidate: RuleCandidate, cacheDirectory: string): Promise<string> {
  const checkout = join(cacheDirectory, candidate.source.repository.replace("/", "--"));
  const priorityPaths = [
    ...candidate.artifact.implementationPaths,
    ...candidate.artifact.testPaths,
    ...candidate.source.paths,
  ];
  const chunks: string[] = [];
  let remaining = 48_000;
  for (const path of [...new Set(priorityPaths)]) {
    if (remaining <= 0) break;
    let content: string;
    try {
      content = await readFile(join(checkout, path), "utf8");
    } catch {
      throw new Error(
        `Missing evidence ${candidate.source.repository}/${path}; run discovery before triage`,
      );
    }
    const excerpt = excerptEvidence(content, candidate, Math.min(24_000, remaining));
    chunks.push(`--- ${path}\n${excerpt}`);
    remaining -= excerpt.length;
  }
  return chunks.join("\n");
}

export function excerptEvidence(content: string, candidate: RuleCandidate, limit: number): string {
  if (content.length <= limit) return content;
  const names = [
    candidate.name,
    candidate.artifact.sourceRuleName,
    candidate.name.replace(/^.*\//, ""),
  ].filter((name): name is string => Boolean(name));
  const indexes = new Set<number>();
  for (const name of names) {
    let index = content.indexOf(name);
    while (index !== -1) {
      indexes.add(index);
      index = content.indexOf(name, index + name.length);
    }
  }
  if (indexes.size === 0) return content.slice(0, limit);

  const windowSize = Math.max(1_000, Math.floor(limit / indexes.size));
  return [...indexes]
    .map((index) => {
      const start = Math.max(0, index - Math.floor(windowSize / 3));
      return content.slice(start, start + windowSize);
    })
    .join("\n…\n")
    .slice(0, limit);
}

async function invokeAgent(prompt: string, options: EnrichmentOptions): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "anti-slop-enrichment-"));
  const promptPath = join(directory, "prompt.txt");
  await writeFile(promptPath, prompt);

  const common = [
    "--print",
    "--model",
    options.model ?? (options.agent === "pi" ? "openai-codex/gpt-5.6-luna" : "luna"),
    "--thinking",
    options.thinking ?? "xhigh",
    "--no-session",
    "--no-tools",
  ];
  const arguments_ =
    options.agent === "omp"
      ? ["omp", ...common, "--no-skills", "--no-rules", `@${promptPath}`]
      : ["pi", ...common, "--no-extensions", "--no-skills", "--no-context-files", `@${promptPath}`];

  try {
    const process = Bun.spawn(arguments_, { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode !== 0) throw new Error(`${options.agent} enrichment failed: ${stderr.trim()}`);
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function parseAssessments(output: string): AgentAssessment[] {
  const unfenced = output.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1");
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start === -1 || end < start) throw new Error("Agent did not return a JSON array");

  const parsed: unknown = JSON.parse(unfenced.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Agent response is not an array");
  return parsed.map(validateAssessment);
}

function validateAssessment(value: unknown, index: number): AgentAssessment {
  if (!isObjectValue(value)) throw new Error(`Agent assessment ${index} is not an object`);
  const classification = Reflect.get(value, "classification");
  if (
    typeof classification !== "string" ||
    !CLASSIFICATIONS.includes(classification as (typeof CLASSIFICATIONS)[number]) ||
    classification === "unreviewed" ||
    classification === "native-policy"
  ) {
    throw new Error(`Agent assessment ${index} has an invalid classification`);
  }
  const requiredAnalysis = Reflect.get(value, "requiredAnalysis");
  if (
    typeof requiredAnalysis !== "string" ||
    !REQUIRED_ANALYSIS.includes(requiredAnalysis as (typeof REQUIRED_ANALYSIS)[number])
  ) {
    throw new Error(`Agent assessment ${index} has invalid requiredAnalysis`);
  }
  const proposedOwner = Reflect.get(value, "proposedOwner");
  if (proposedOwner !== "ast-grep" && proposedOwner !== "oxlint" && proposedOwner !== "other") {
    throw new Error(`Agent assessment ${index} has invalid proposedOwner`);
  }
  const ownerMatchesAnalysis =
    (requiredAnalysis === "syntax" && proposedOwner === "ast-grep") ||
    ((requiredAnalysis === "scope" || requiredAnalysis === "control-flow") &&
      proposedOwner === "oxlint") ||
    (requiredAnalysis === "type-information" && proposedOwner !== "ast-grep") ||
    (requiredAnalysis === "workspace" && proposedOwner !== "ast-grep");
  if (!ownerMatchesAnalysis) {
    throw new Error(
      `Agent assessment ${index} assigns ${requiredAnalysis} analysis to ${proposedOwner}`,
    );
  }
  const confidence = Reflect.get(value, "confidence");

  return {
    id: requiredString(value, "id", index),
    summary: requiredString(value, "summary", index),
    defect: requiredString(value, "defect", index),
    remediation: requiredString(value, "remediation", index),
    applicability: stringArray(value, "applicability", index),
    dependencies: stringArray(value, "dependencies", index),
    exceptions: stringArray(value, "exceptions", index),
    requiredAnalysis: requiredAnalysis as AgentAssessment["requiredAnalysis"],
    proposedOwner,
    classification: classification as AgentAssessment["classification"],
    failedConditions: stringArray(value, "failedConditions", index),
    confidence:
      typeof confidence === "number" && confidence >= 0 && confidence <= 1 ? confidence : 0,
  };
}

function requiredString(value: object, key: string, index: number): string {
  const property = Reflect.get(value, key);
  if (typeof property !== "string" || property.length === 0) {
    throw new Error(`Agent assessment ${index} has invalid ${key}`);
  }
  return property;
}

function stringArray(value: object, key: string, index: number): string[] {
  const property = Reflect.get(value, key);
  if (!Array.isArray(property) || property.some((item) => typeof item !== "string")) {
    throw new Error(`Agent assessment ${index} has invalid ${key}`);
  }
  return property;
}

function isObjectValue(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
