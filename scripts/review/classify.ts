#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import type { ArtifactKind } from "../discovery/types.ts";
import { loadRules, reviewPaths } from "./project.ts";
import { FIRST_PARTY_REPOSITORY } from "./rules.ts";
import { ECOSYSTEMS, slug, TAXONOMY } from "./taxonomy.ts";
import type { Classification, ClassificationCache, ReviewRule } from "./types.ts";

const EXCERPT_CHARACTERS = 1_500;
const CONCURRENCY = 8;

const KIND_WORDS: { [kind in ArtifactKind]: string } = {
  "ast-grep-rule": "a structural ast-grep lint rule",
  "oxlint-plugin-rule": "a custom lint rule implementation",
  "oxlint-policy": "an entry in a lint configuration",
  "typed-check": "a type-aware check",
  "workspace-check": "a check over repository files",
  "agent-guidance": "written guidance for coding agents",
};

const DOMAIN_OPTIONS: { [option: string]: { what: string; covers?: string[] } } = {
  ...Object.fromEntries(
    TAXONOMY.map(({ domain, categories }) => [
      slug(domain),
      { what: domain, covers: [...categories] },
    ]),
  ),
  other: { what: "None of the areas above" },
};

/** One category question per domain rides in the same request; code keeps the chosen domain's. */
const CATEGORY_QUESTIONS = new Map(
  TAXONOMY.map(({ domain, categories }) => {
    const options: { [option: string]: string } = {
      ...Object.fromEntries(categories.map((category) => [slug(category), category])),
      other: `None of these ${domain} topics`,
    };
    return [
      `category_${slug(domain)}`,
      choice(`Within ${domain}, which topic does the rule described in \`rule\` address?`, options),
    ];
  }),
);

const QUESTIONS = {
  ...Object.fromEntries(CATEGORY_QUESTIONS),
  domain: choice(
    {
      question: "Which area of code quality does the rule described in `rule` protect?",
      inspect: "rule",
      focus: "Judge the defect the rule prevents, not the library it mentions.",
    },
    DOMAIN_OPTIONS,
  ),
  ecosystem: choice(
    "Which library or runtime must a codebase use for the rule described in `rule` to apply?",
    ECOSYSTEMS,
  ),
  project_specific: noul(
    {
      question:
        "Does the rule described in `rule` require a package, directory, service, or tool that exists only in the repository it came from?",
      focus:
        "Ignore file ignore lists and test paths. Judge what the rule asks code to do or avoid.",
    },
    {
      true: {
        what: "The rule names an internal package, path, or in-house tool",
        examples: [
          "Import UI primitives from @acme/ui instead of apps/web/components",
          "Keep SVG files only under assets/icons",
          "Run checks through the ./scripts/verify wrapper",
        ],
      },
      false: {
        what: "The rule targets a language feature or a public library, so any repository could adopt it",
        examples: [
          "Do not use Record<string, unknown>",
          "Use Effect.fn instead of a function that returns Effect.gen",
          "Return the initializer directly instead of a single-use local",
        ],
      },
    },
  ),
};

const root = resolve(import.meta.dir, "../..");
const paths = reviewPaths(root);
const force = Bun.argv.includes("--force");
const cache = await readFile(paths.classificationPath, "utf8")
  .then((content) => JSON.parse(content) as ClassificationCache)
  .catch((): ClassificationCache => ({ model: "", rules: {} }));

const { rules } = await loadRules(paths);
const inputs = await Promise.all(
  rules.map(async (rule) => {
    const state = await ruleState(rule);
    const input = new Bun.CryptoHasher("sha256").update(JSON.stringify(state)).digest("hex");
    return { rule, state, input };
  }),
);
const limitFlag = Bun.argv.find((value) => value.startsWith("--limit="));
const pending = inputs
  .filter(({ rule, input }) => force || cache.rules[rule.key]?.input !== input)
  .slice(0, limitFlag ? Number.parseInt(limitFlag.slice("--limit=".length), 10) : undefined);
console.log(`${pending.length} of ${rules.length} rules need classification.`);

const client = new TypeSafeClient();
let completed = 0;
let model = cache.model;
const failures: string[] = [];
const queue = [...pending];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        const result = await classify(next.state, next.input);
        cache.rules[next.rule.key] = result.classification;
        model = result.model;
      } catch (error) {
        failures.push(`${next.rule.key}: ${error instanceof Error ? error.message : error}`);
      }
      completed += 1;
      if (completed % 25 === 0) {
        console.log(`${completed}/${pending.length}`);
        await save();
      }
    }
  }),
);

const liveKeys = new Set(rules.map(({ key }) => key));
for (const key of Object.keys(cache.rules)) if (!liveKeys.has(key)) delete cache.rules[key];
await save();
console.log(`Classified ${completed - failures.length} rules with ${model}.`);
if (failures.length > 0) {
  console.error(`${failures.length} failed:\n${failures.join("\n")}`);
  process.exitCode = 1;
}

async function classify(
  state: Awaited<ReturnType<typeof ruleState>>,
  input: string,
): Promise<{ model: string; classification: Classification }> {
  const response = await client.systemOne({ state, questions: QUESTIONS });
  const { answers } = response;
  const domainEntry = TAXONOMY.find(({ domain }) => slug(domain) === answers.domain.choice);
  const categoryAnswer = domainEntry
    ? new Map(Object.entries(answers)).get(`category_${slug(domainEntry.domain)}`)
    : undefined;
  const category =
    categoryAnswer?.type === "choice"
      ? domainEntry?.categories.find((candidate) => slug(candidate) === categoryAnswer.choice)
      : undefined;
  return {
    model: response.model,
    classification: {
      input,
      domain: domainEntry?.domain ?? "Unsorted",
      category: category ?? "Unsorted",
      ecosystem: answers.ecosystem.choice,
      projectSpecific: answers.project_specific.noul,
      confidence: {
        domain: domainEntry ? answers.domain.confidence : 0,
        category: category && categoryAnswer?.type === "choice" ? categoryAnswer.confidence : 0,
        ecosystem: answers.ecosystem.confidence,
      },
    },
  };
}

/** The smallest description of a rule that answers every question. */
async function ruleState(rule: ReviewRule) {
  const implementation = rule.sightings.find(
    ({ artifact }) => artifact.kind !== "oxlint-policy" && artifact.implementationPaths.length > 0,
  );
  const excerpt = implementation
    ? await readExcerpt(
        implementation.source.repository,
        implementation.artifact.implementationPaths[0],
      )
    : undefined;
  return {
    rule: {
      name: rule.name,
      configured_as: [
        ...new Set(rule.sightings.map(({ artifact, name }) => artifact.sourceRuleName ?? name)),
      ],
      form: rule.kinds.map((kind) => KIND_WORDS[kind]),
      description: rule.description,
      found_in: rule.sources,
      ...(excerpt ? { source_excerpt: excerpt } : {}),
    },
  };
}

async function readExcerpt(
  repository: string,
  path: string | undefined,
): Promise<string | undefined> {
  if (!path) return undefined;
  const base =
    repository === FIRST_PARTY_REPOSITORY
      ? root
      : join(root, "discovery/cache", repository.replace("/", "--"));
  return readFile(join(base, path), "utf8")
    .then((content) => content.slice(0, EXCERPT_CHARACTERS))
    .catch(() => undefined);
}

async function save(): Promise<void> {
  await mkdir(dirname(paths.classificationPath), { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(cache.rules).sort(([left], [right]) => left.localeCompare(right)),
  );
  await writeFile(
    paths.classificationPath,
    `${JSON.stringify({ model, rules: sorted }, null, 2)}\n`,
  );
}
