import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type {
  ArtifactKind,
  CandidateCatalog,
  Classification,
  RuleCandidate,
  SourceManifest,
  SourceSpec,
} from "./types.ts";

const RULE_SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);
const MARKDOWN_RULE_NAME = /`((?:[a-z0-9-]+\/)?(?:no|prefer|require|enforce|ban)-[a-z0-9-]+)`/g;
const OXLINT_CONFIG =
  /^(?:\.oxlintrc(?:\.jsonc?|\.ya?ml)?|oxlint\.config\.(?:js|mjs|cjs|ts|mts|cts))$/;
const AST_GREP_CONFIG = /^(?:sgconfig|ast-grep)(?:\.[\w-]+)?\.ya?ml$/;
const TEST_MARKER =
  /(?:^|\/)(?:test|tests|rule-tests|fixtures)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/;

export type DiscoveryOptions = {
  cacheDirectory: string;
  now?: () => Date;
};

type Checkout = {
  spec: SourceSpec;
  directory: string;
  commit: string;
  license?: string;
  files: string[];
};

type CandidateInput = {
  name: string;
  description: string;
  kind: ArtifactKind;
  sourceRuleName?: string;
  implementationPaths: string[];
  testPaths: string[];
  content: string;
  classification?: Classification;
};

type TestEvidence = {
  path: string;
  content: string;
};

export async function loadManifest(path: string): Promise<SourceManifest> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isObjectValue(parsed)) throw new Error(`Invalid source manifest: ${path}`);
  const entries = Reflect.get(parsed, "repositories");
  if (!Array.isArray(entries)) throw new Error(`Invalid source manifest: ${path}`);

  const repositories = entries.map((entry, index) => {
    if (!isObjectValue(entry)) throw new Error(`Invalid repository at sources[${index}]`);
    const repo = Reflect.get(entry, "repo");
    const ref = Reflect.get(entry, "ref");
    if (typeof repo !== "string" || typeof ref !== "string") {
      throw new Error(`Invalid repository at sources[${index}]`);
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || ref.length === 0) {
      throw new Error(`Invalid repository source: ${repo}@${ref}`);
    }
    return { repo, ref };
  });

  return { repositories };
}

export async function discoverCatalog(
  manifest: SourceManifest,
  options: DiscoveryOptions,
): Promise<CandidateCatalog> {
  const checkouts = await Promise.all(
    manifest.repositories.map((spec) => checkoutRepository(spec, options.cacheDirectory)),
  );
  const candidateGroups = await Promise.all(checkouts.map(discoverCheckout));
  const candidates = classifySimilarities(candidateGroups.flat());

  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    sources: checkouts.map(({ spec, commit }) => ({
      repository: spec.repo,
      ref: spec.ref,
      commit,
    })),
    candidates,
  };
}

export async function discoverDirectory(
  directory: string,
  spec: SourceSpec,
  commit = "local",
): Promise<RuleCandidate[]> {
  const files = await walkFiles(directory);
  const checkout: Checkout = {
    spec,
    directory,
    commit,
    files,
    license: await readPackageLicense(directory),
  };
  return classifySimilarities(await discoverCheckout(checkout));
}

async function checkoutRepository(spec: SourceSpec, cacheDirectory: string): Promise<Checkout> {
  const directory = join(cacheDirectory, spec.repo.replace("/", "--"));
  const gitDirectory = join(directory, ".git");

  if (await exists(gitDirectory)) {
    await runGit(["-C", directory, "fetch", "--depth=1", "origin", spec.ref]);
    await runGit(["-C", directory, "checkout", "--detach", "FETCH_HEAD"]);
  } else {
    await rm(directory, { recursive: true, force: true });
    await runGit([
      "clone",
      "--filter=blob:none",
      "--depth=1",
      "--branch",
      spec.ref,
      `https://github.com/${spec.repo}.git`,
      directory,
    ]);
  }

  const commit = (await runGit(["-C", directory, "rev-parse", "HEAD"])).trim();
  return {
    spec,
    directory,
    commit,
    files: await walkFiles(directory),
    license: await readPackageLicense(directory),
  };
}

async function discoverCheckout(checkout: Checkout): Promise<RuleCandidate[]> {
  const candidates: CandidateInput[] = [];
  const tests = await Promise.all(
    checkout.files
      .filter((path) => TEST_MARKER.test(path))
      .map(async (path) => ({
        path,
        content: await readText(join(checkout.directory, path)),
      })),
  );

  for (const path of checkout.files) {
    if (path.startsWith(".git/")) continue;
    const absolutePath = join(checkout.directory, path);
    const extension = extname(path).toLowerCase();
    const fileName = basename(path);

    if ((extension === ".yml" || extension === ".yaml") && !AST_GREP_CONFIG.test(fileName)) {
      const content = await readText(absolutePath);
      const id = yamlScalar(content, "id");
      if (id && /^language\s*:/m.test(content)) {
        candidates.push({
          name: id,
          description: yamlScalar(content, "message") ?? `ast-grep rule ${id}`,
          kind: "ast-grep-rule",
          sourceRuleName: id,
          implementationPaths: [path],
          testPaths: relatedTests(path, id, tests),
          content,
        });
        continue;
      }
    }

    if (OXLINT_CONFIG.test(fileName)) {
      const content = await readText(absolutePath);
      candidates.push(...discoverOxlintPolicy(path, content));
      continue;
    }

    if (
      RULE_SOURCE_EXTENSIONS.has(extension) &&
      !TEST_MARKER.test(path) &&
      /(?:^|\/)rules?\//.test(path)
    ) {
      const content = await readText(absolutePath);
      if (/^index\.[cm]?[jt]sx?$/.test(fileName)) continue;
      if (
        !looksLikeRuleImplementation(content) &&
        !(
          /(?:^|\/)workspace(?:-|_)rules?\//.test(path) &&
          /\bcheck\s*:/.test(content) &&
          /\breport\s*\(/.test(content)
        )
      )
        continue;
      const name = ruleNameFromSource(path);
      const kind = classifySourceRule(path, content);
      candidates.push({
        name,
        description: sourceDescription(content) ?? `${kind.replaceAll("-", " ")} ${name}`,
        kind,
        sourceRuleName: name,
        implementationPaths: [path],
        testPaths: relatedTests(path, name, tests),
        content,
      });
      continue;
    }

    if (fileName === ".antislop.jsonl") {
      const content = await readText(absolutePath);
      candidates.push(...discoverJsonLinesGuidance(path, content));
      continue;
    }

    if (extension === ".md" && isRelevantGuidancePath(path)) {
      const content = await readText(absolutePath);
      candidates.push(...discoverMarkdownGuidance(path, content));
    }
  }

  return deduplicateWithinSource(candidates.map((candidate) => makeCandidate(checkout, candidate)));
}

function discoverOxlintPolicy(path: string, content: string): CandidateInput[] {
  const ruleNames = new Set<string>();
  const parsed = parseJsonConfig(content);
  if (parsed) collectRuleNames(parsed, ruleNames);

  if (ruleNames.size === 0) {
    for (const match of content.matchAll(/["']((?:[a-z0-9-]+\/)?[a-z][a-z0-9-]+)["']\s*:/gi)) {
      const name = match[1];
      if (!name) continue;
      if (/^(?:rules?|plugins?|overrides?|files?|settings?)$/.test(name)) continue;
      if (/^(?:off|warn|error)$/.test(name)) continue;
      ruleNames.add(name);
    }
  }

  return [...ruleNames].sort().map((name) => ({
    name,
    description: `Oxlint configuration enables or configures ${name}`,
    kind: "oxlint-policy",
    sourceRuleName: name,
    implementationPaths: [path],
    testPaths: [],
    content: `${name}\n${content}`,
    classification: "native-policy",
  }));
}

function discoverJsonLinesGuidance(path: string, content: string): CandidateInput[] {
  const candidates: CandidateInput[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    if (line.trim().length === 0) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (!isObjectValue(entry)) continue;
      const description = firstString(entry, ["text", "description", "rule", "message"]);
      if (!description) continue;
      const name = firstString(entry, ["id", "name"]) ?? `guidance-line-${index + 1}`;
      candidates.push({
        name,
        description,
        kind: "agent-guidance",
        sourceRuleName: name,
        implementationPaths: [path],
        testPaths: [],
        content: line,
      });
    } catch {
      // Malformed lines remain source data, not candidates.
    }
  }
  return candidates;
}

function discoverMarkdownGuidance(path: string, content: string): CandidateInput[] {
  const candidates: CandidateInput[] = [];
  const seen = new Set<string>();
  const canonicalGuidance = ["AGENTS.md", "CLAUDE.md", "SKILL.md"].includes(basename(path));
  for (const [index, line] of content.split("\n").entries()) {
    let documentedRuleFound = false;
    for (const match of line.matchAll(MARKDOWN_RULE_NAME)) {
      const name = match[1];
      if (!name || seen.has(name)) continue;
      documentedRuleFound = true;
      seen.add(name);
      candidates.push({
        name,
        description: stripMarkdown(line).slice(0, 500) || `Documented rule ${name}`,
        kind: "agent-guidance",
        sourceRuleName: name,
        implementationPaths: [path],
        testPaths: [],
        content: `${index + 1}:${line}`,
      });
    }

    const description = stripMarkdown(line).slice(0, 500);
    if (
      canonicalGuidance &&
      !documentedRuleFound &&
      /^(?:never|always|avoid|prefer|do not|don't|must)\b/i.test(description)
    ) {
      const name = `guidance-${slug(description).slice(0, 48)}`;
      candidates.push({
        name,
        description,
        kind: "agent-guidance",
        sourceRuleName: name,
        implementationPaths: [path],
        testPaths: [],
        content: `${index + 1}:${line}`,
      });
    }
  }
  return candidates;
}

function makeCandidate(checkout: Checkout, input: CandidateInput): RuleCandidate {
  const sourceKey = `${checkout.spec.repo}:${input.kind}:${input.name}:${input.implementationPaths.join(",")}`;
  const id = `${checkout.spec.repo.replace("/", "--")}:${slug(input.name)}:${hash(sourceKey).slice(0, 8)}`;
  return {
    id,
    name: input.name,
    description: input.description,
    source: {
      repository: checkout.spec.repo,
      ref: checkout.spec.ref,
      commit: checkout.commit,
      paths: [...new Set([...input.implementationPaths, ...input.testPaths])].sort(),
      ...(checkout.license ? { license: checkout.license } : {}),
    },
    artifact: {
      kind: input.kind,
      ...(input.sourceRuleName ? { sourceRuleName: input.sourceRuleName } : {}),
      implementationPaths: input.implementationPaths,
      testPaths: input.testPaths,
    },
    fingerprint: hash(normalizeSource(input.content)),
    admission: {
      classification: input.classification ?? "unreviewed",
      failedConditions: initialAdmissionFailures(input),
    },
    similarity: { exactDuplicates: [], relatedCandidates: [] },
  };
}

export function classifySimilarities(candidates: RuleCandidate[]): RuleCandidate[] {
  const exact = Map.groupBy(candidates, (candidate) => candidate.fingerprint);
  const byName = Map.groupBy(candidates, (candidate) => normalizeRuleName(candidate.name));

  return candidates
    .map((candidate) => {
      const exactDuplicates = (exact.get(candidate.fingerprint) ?? [])
        .filter(({ id }) => id !== candidate.id)
        .map(({ id }) => id)
        .sort();
      const relatedCandidates = (byName.get(normalizeRuleName(candidate.name)) ?? [])
        .filter(({ id }) => id !== candidate.id && !exactDuplicates.includes(id))
        .map(({ id }) => id)
        .sort();
      return {
        ...candidate,
        similarity: { exactDuplicates, relatedCandidates },
      };
    })
    .sort(compareCandidates);
}

function deduplicateWithinSource(candidates: RuleCandidate[]): RuleCandidate[] {
  const chosen = new Map<string, RuleCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.artifact.kind}:${identityRuleName(candidate.name)}`;
    const current = chosen.get(key);
    if (!current || sourcePreference(candidate) < sourcePreference(current)) {
      chosen.set(key, candidate);
      continue;
    }
    if (current.artifact.kind === "agent-guidance") {
      current.source.paths = [
        ...new Set([...current.source.paths, ...candidate.source.paths]),
      ].sort();
    }
  }

  const executableByName = new Map(
    [...chosen.values()]
      .filter(
        ({ artifact }) => artifact.kind !== "agent-guidance" && artifact.kind !== "oxlint-policy",
      )
      .map((candidate) => [identityRuleName(candidate.name), candidate]),
  );
  return [...chosen.values()].filter((candidate) => {
    if (candidate.artifact.kind !== "agent-guidance") return true;
    const executable = executableByName.get(identityRuleName(candidate.name));
    if (!executable) return true;
    executable.source.paths = [
      ...new Set([...executable.source.paths, ...candidate.source.paths]),
    ].sort();
    return false;
  });
}

function initialAdmissionFailures(input: CandidateInput): string[] {
  if (input.kind === "oxlint-policy") return [];
  const failures: string[] = [];
  if (input.kind === "agent-guidance")
    failures.push("No executable rule implementation discovered.");
  if (input.testPaths.length === 0) failures.push("No behavioral tests discovered.");
  failures.push("Native Oxlint coverage has not been verified.");
  failures.push("Repository scan evidence has not been recorded.");
  return failures;
}

function classifySourceRule(path: string, content: string): ArtifactKind {
  if (/(?:^|\/)workspace(?:-|_)rules?\//.test(path) || /workspace rule/i.test(content)) {
    return "workspace-check";
  }
  if (
    /(?:^|\/)typed(?:\/|[-_])/.test(path) ||
    /typescript compiler api|typechecker|type checker/i.test(content)
  ) {
    return "typed-check";
  }
  return "oxlint-plugin-rule";
}

function relatedTests(path: string, name: string, tests: TestEvidence[]): string[] {
  const stem = basename(path).replace(/\.[^.]+$/, "");
  const tokens = new Set([stem, name, name.replaceAll("-", "_")]);
  return tests
    .filter(({ path: testPath, content }) => {
      const sharedRuleSuite =
        /\bfor\s*\(\s*const\s+ruleName\s+of\s+\w*RuleNames\b/.test(content) &&
        /\b(?:async\s+)?function\s+lint\b/.test(content);
      return (
        sharedRuleSuite ||
        [...tokens].some((token) => testPath.includes(token) || content.includes(token))
      );
    })
    .map(({ path: testPath }) => testPath)
    .sort();
}

function ruleNameFromSource(path: string): string {
  return basename(path).replace(/\.(?:[cm]?[jt]sx?)$/, "");
}

function sourcePreference(candidate: RuleCandidate): number {
  const path = candidate.artifact.implementationPaths[0];
  if (!path) throw new Error(`Candidate ${candidate.id} has no implementation path`);
  return (path.includes("/assets/") ? 10_000 : 0) + path.length;
}

function sourceDescription(content: string): string | undefined {
  const patterns = [
    /\bdescription\s*:\s*["'`]([^"'`]+)["'`]/,
    /\bmessage\s*:\s*["'`]([^"'`]+)["'`]/,
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern)?.[1];
    if (match) return match.replace(/\s+/g, " ").trim();
  }
  return undefined;
}

function looksLikeRuleImplementation(content: string): boolean {
  return /(?:\bcreateRule\b|\bdefineRule\b|\bcontext\.report\b|\bmeta\s*:|\bmessages\s*:|\bRule\.RuleModule\b)/.test(
    content,
  );
}

function parseJsonConfig(content: string): unknown | undefined {
  try {
    return JSON.parse(content);
  } catch {
    try {
      return JSON.parse(
        content
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "")
          .replace(/,\s*([}\]])/g, "$1"),
      );
    } catch {
      return undefined;
    }
  }
}

function collectRuleNames(value: unknown, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRuleNames(item, names);
    return;
  }
  if (!isObjectValue(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "rules" && isObjectValue(child)) {
      for (const name of Object.keys(child)) names.add(name);
    } else {
      collectRuleNames(child, names);
    }
  }
}

function yamlScalar(content: string, key: string): string | undefined {
  const value = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
  return value?.replace(/^(["'])(.*)\1$/, "$2");
}

function isRelevantGuidancePath(path: string): boolean {
  const fileName = basename(path);
  return (
    fileName === "AGENTS.md" ||
    fileName === "CLAUDE.md" ||
    fileName === "SKILL.md" ||
    /(?:anti[-_]?slop|rule[-_]?catalog|lint|rules?|skill)/i.test(path)
  );
}

function normalizeRuleName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^.*\//, "")
    .replace(/^(?:no|prefer|require|enforce|ban)-/, "")
    .replace(/[^a-z0-9]+/g, "-");
}

function identityRuleName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^.*\//, "")
    .replace(/[^a-z0-9]+/g, "-");
}

function normalizeSource(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compareCandidates(left: RuleCandidate, right: RuleCandidate): number {
  return (
    left.source.repository.localeCompare(right.source.repository) ||
    left.name.localeCompare(right.name)
  );
}

async function readPackageLicense(directory: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    if (!isObjectValue(parsed)) return undefined;
    const license = Reflect.get(parsed, "license");
    return typeof license === "string" ? license : undefined;
  } catch {
    return undefined;
  }
}

async function walkFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(root, absolutePath)));
    else if (entry.isFile()) files.push(relative(root, absolutePath));
  }
  return files.sort();
}

async function runGit(arguments_: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...arguments_], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${arguments_.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "candidate"
  );
}

function stripMarkdown(value: string): string {
  return value
    .replace(/[`*_#[\]]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/^\s*[-|]\s*/, "")
    .trim();
}

function firstString(value: object, keys: string[]): string | undefined {
  for (const key of keys) {
    const property = Reflect.get(value, key);
    if (typeof property === "string") return property;
  }
  return undefined;
}

function isObjectValue(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
