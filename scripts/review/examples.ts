import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Lang, parse, type SgNode } from "@ast-grep/napi";
import yaml from "js-yaml";
import { bareName, FIRST_PARTY_REPOSITORY } from "./rules.ts";
import type { ExampleSet, ReviewRule, RuleExample, Sighting } from "./types.ts";

type Cases = Pick<ExampleSet, "breaks" | "passes">;

/**
 * Recovers the snippets a rule reports and accepts from its Oxlint docs page and every linked
 * test file. Foreign code is parsed, never executed.
 */
export async function loadRuleExamples(
  rule: ReviewRule,
  root: string,
  cacheDirectory: string,
): Promise<ExampleSet[]> {
  const sets: ExampleSet[] = [];
  if (rule.delivery.kind === "native") {
    const docs = await loadDocsExamples(rule.delivery.docsUrl, cacheDirectory).catch(
      () => undefined,
    );
    if (docs && hasCases(docs)) {
      sets.push({
        origin: "oxlint-docs",
        label: "Oxlint docs",
        url: rule.delivery.docsUrl,
        ...docs,
      });
    }
  }
  for (const sighting of rule.sightings) {
    for (const path of new Set(sighting.artifact.testPaths)) {
      const content = await readFile(
        join(checkoutRoot(sighting, root, cacheDirectory), path),
        "utf8",
      ).catch(() => undefined);
      if (content === undefined) continue;
      const extracted = extractTestExamples(rule.name, path, content);
      if (!extracted || !hasCases(extracted)) continue;
      const repository =
        sighting.origin === "first-party" ? FIRST_PARTY_REPOSITORY : sighting.source.repository;
      sets.push({
        ...extracted,
        label: `${repository} · ${path.split("/").at(-1)}`,
        url: `https://github.com/${repository}/blob/${sighting.source.commit}/${path}`,
      });
    }
  }
  return sets;
}

export function checkoutRoot(sighting: Sighting, root: string, cacheDirectory: string): string {
  return sighting.origin === "first-party"
    ? root
    : join(cacheDirectory, sighting.source.repository.replace("/", "--"));
}

function hasCases({ breaks, passes }: Cases): boolean {
  return breaks.length > 0 || passes.length > 0;
}

/** Docs pages track the latest Oxlint release, so one fetch per rule is cached under discovery. */
async function loadDocsExamples(docsUrl: string, cacheDirectory: string): Promise<Cases> {
  const slug = docsUrl
    .replace(/^.*\/rules\//, "")
    .replace(/\.html$/, "")
    .replace("/", "--");
  const cachePath = join(cacheDirectory, "oxlint-docs", `${slug}.json`);
  const cached = await readFile(cachePath, "utf8")
    .then((content) => JSON.parse(content) as Cases)
    .catch(() => undefined);
  if (cached) return cached;
  const response = await fetch(docsUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Docs request failed with ${response.status}`);
  const cases = parseDocsExamples(await response.text());
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cases, null, 2)}\n`);
  return cases;
}

/** Reads each "Examples of incorrect/correct code" heading and the code block that follows it. */
export function parseDocsExamples(html: string): Cases {
  const headings = [...html.matchAll(/Examples of <strong>(incorrect|correct)<\/strong>/g)];
  const cases: Cases = { breaks: [], passes: [] };
  headings.forEach((heading, index) => {
    const start = heading.index;
    const end = headings[index + 1]?.index ?? start + 40_000;
    const block = /<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/.exec(html.slice(start, end));
    if (!block?.[1]) return;
    const code = normalizeCode(decodeEntities(block[1].replace(/<[^>]+>/g, "")));
    if (code.length === 0) return;
    (heading[1] === "incorrect" ? cases.breaks : cases.passes).push({ code });
  });
  return cases;
}

export function extractTestExamples(
  ruleName: string,
  path: string,
  content: string,
): Omit<ExampleSet, "label" | "url"> | undefined {
  if (/\.ya?ml$/.test(path)) {
    return { origin: "ast-grep-test", ...astGrepCases(ruleName, content) };
  }
  if (!/\.[cm]?[jt]sx?$/.test(path)) return undefined;
  const root = parse(/\.[jt]sx$/.test(path) ? Lang.Tsx : Lang.TypeScript, content).root();
  const ruleTester = ruleTesterCases(ruleName, root);
  if (ruleTester) return { origin: "rule-tester", ...ruleTester };
  const bunTest = bunTestCases(ruleName, root);
  return bunTest ? { origin: "bun-test", ...bunTest } : undefined;
}

/**
 * ast-grep tests list `valid` and `invalid` snippets. A `-tsx` id covers the same rule, and a file
 * whose ids never name the rule is a supplement the rule linked, so all of it applies.
 */
function astGrepCases(ruleName: string, content: string): Cases {
  const documents = yaml
    .loadAll(content)
    .filter((document): document is object => typeof document === "object" && document !== null);
  const matching = documents.filter((document) => {
    const id = Reflect.get(document, "id");
    return typeof id === "string" && id.startsWith(ruleName);
  });
  const cases: Cases = { breaks: [], passes: [] };
  for (const document of matching.length > 0 ? matching : documents) {
    for (const [field, target] of [
      ["invalid", cases.breaks],
      ["valid", cases.passes],
    ] as const) {
      const snippets: unknown = Reflect.get(document, field);
      if (!Array.isArray(snippets)) continue;
      for (const snippet of snippets) {
        if (typeof snippet === "string") target.push({ code: normalizeCode(snippet) });
      }
    }
  }
  return cases;
}

/**
 * `tester.run(name, rule, { valid, invalid })`. A shared suite holds many runs, so the run whose
 * name matches the rule wins; a file with a single run belongs to the rule that linked it.
 */
function ruleTesterCases(ruleName: string, root: SgNode): Cases | undefined {
  const runs = root
    .findAll({ rule: { pattern: "$TESTER.run($NAME, $RULE, $CASES)" } })
    .filter((run) => run.getMatch("CASES")?.kind() === "object");
  const run =
    runs.find((candidate) => {
      const name = literalString(candidate.getMatch("NAME"));
      return name !== undefined && bareName(name) === ruleName;
    }) ?? (runs.length === 1 ? runs[0] : undefined);
  const suite = run?.getMatch("CASES");
  if (!suite) return undefined;
  const cases: Cases = { breaks: [], passes: [] };
  for (const property of namedChildren(suite)) {
    if (property.kind() !== "pair") continue;
    const key = property.field("key")?.text();
    const value = property.field("value");
    if ((key !== "valid" && key !== "invalid") || value?.kind() !== "array") continue;
    for (const element of namedChildren(value)) {
      const example = testerCase(element);
      if (example) (key === "invalid" ? cases.breaks : cases.passes).push(example);
    }
  }
  return cases;
}

function testerCase(element: SgNode): RuleExample | undefined {
  const direct = literalString(element);
  if (direct !== undefined) return { code: normalizeCode(direct) };
  if (element.kind() !== "object") return undefined;
  const fields = new Map(
    namedChildren(element)
      .filter((property) => property.kind() === "pair")
      .map((property) => [property.field("key")?.text(), property.field("value")]),
  );
  const code = literalString(fields.get("code"));
  if (code === undefined) return undefined;
  const output = literalString(fields.get("output"));
  return {
    code: normalizeCode(code),
    ...(output !== undefined && output !== code ? { fixed: normalizeCode(output) } : {}),
  };
}

/**
 * Suites that lint fixture files directly, as oxray does. A test belongs to the rule when it sits
 * in a `describe` named after the rule or names the rule itself. Each `lint(code)` result is then
 * sorted by its assertions: output that must contain the rule reports it, output that must not
 * contain it passes, and the expected exit code decides the rest.
 */
function bunTestCases(ruleName: string, root: SgNode): Cases | undefined {
  const named = root
    .findAll({ rule: { pattern: "describe($NAME, $BODY)" } })
    .find((candidate) => literalString(candidate.getMatch("NAME")) === ruleName);
  const cases: Cases = { breaks: [], passes: [] };
  if (named) {
    for (const declarator of named.findAll({ rule: { kind: "variable_declarator" } })) {
      const name = declarator.field("name")?.text() ?? "";
      const value = declarator.field("value");
      const array = value?.kind() === "as_expression" ? namedChildren(value)[0] : value;
      if (array?.kind() !== "array" || !/cases$/i.test(name)) continue;
      const target = /invalid/i.test(name)
        ? cases.breaks
        : /valid/i.test(name)
          ? cases.passes
          : undefined;
      for (const element of namedChildren(array)) {
        const code = literalString(
          element.kind() === "array" ? namedChildren(element)[0] : element,
        );
        if (target && code !== undefined) target.push({ code: normalizeCode(code) });
      }
    }
  }

  const rule = `(?<![\\w-])${escapeRegExp(ruleName)}(?![\\w-])`;
  const mentions = new RegExp(rule);
  const namedRange = named?.range();
  for (const test of root.findAll({ rule: { pattern: "test($TITLE, $BODY)" } })) {
    const body = test.getMatch("BODY")?.text() ?? "";
    const inNamedBlock =
      namedRange !== undefined &&
      test.range().start.index >= namedRange.start.index &&
      test.range().end.index <= namedRange.end.index;
    if (!inNamedBlock && !mentions.test(body)) continue;
    for (const call of test.findAll({ rule: { pattern: "lint($$$ARGS)" } })) {
      const code = literalString(call.field("arguments")?.child(1));
      if (code === undefined) continue;
      const declarator = call.ancestors().find((node) => node.kind() === "variable_declarator");
      const result = escapeRegExp(declarator?.field("name")?.text() ?? "result");
      const expectOn = (field: string, assertion: string) =>
        new RegExp(`expect\\(${result}\\.${field}\\)\\.${assertion}`);
      const reports =
        expectOn("output", `toContain\\([^;]*${rule}`).test(body) ||
        (!expectOn("output", `not\\.toContain\\([^;]*${rule}`).test(body) &&
          expectOn("exitCode", "toBe\\(1\\)").test(body));
      const accepts =
        !reports &&
        (expectOn("output", `not\\.toContain\\([^;]*${rule}`).test(body) ||
          expectOn("exitCode", "toBe\\(0\\)").test(body));
      if (reports) {
        const fixed = test
          .findAll({ rule: { pattern: "expect($RESULT.code).toBe($FIXED)" } })
          .find(
            (match) =>
              match.getMatch("RESULT")?.text() === (declarator?.field("name")?.text() ?? "result"),
          );
        const output = literalString(fixed?.getMatch("FIXED"));
        cases.breaks.push({
          code: normalizeCode(code),
          ...(output !== undefined && output !== code ? { fixed: normalizeCode(output) } : {}),
        });
      } else if (accepts) {
        cases.passes.push({ code: normalizeCode(code) });
      }
    }
  }
  return hasCases(cases)
    ? { breaks: unique(cases.breaks), passes: unique(cases.passes) }
    : undefined;
}

function unique(examples: RuleExample[]): RuleExample[] {
  const seen = new Set<string>();
  return examples.filter(({ code }) => !seen.has(code) && Boolean(seen.add(code)));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The value of a string or substitution-free template literal. */
function literalString(node: SgNode | null | undefined): string | undefined {
  if (!node) return undefined;
  const kind = node.kind();
  if (kind === "template_string") {
    if (namedChildren(node).some((child) => child.kind() === "template_substitution")) {
      return undefined;
    }
    return unescapeLiteral(node.text().slice(1, -1));
  }
  if (kind === "string") return unescapeLiteral(node.text().slice(1, -1));
  return undefined;
}

const SIMPLE_ESCAPES = new Map([
  ["n", "\n"],
  ["t", "\t"],
  ["r", "\r"],
  ["b", "\b"],
  ["f", "\f"],
  ["v", "\v"],
  ["0", "\0"],
]);

function unescapeLiteral(body: string): string {
  return body.replace(
    /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r?\n|[\s\S])/g,
    (_, escape: string) => {
      if (escape.startsWith("u{"))
        return String.fromCodePoint(Number.parseInt(escape.slice(2, -1), 16));
      if (/^[ux][0-9a-fA-F]+$/.test(escape)) {
        return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
      }
      if (escape.endsWith("\n")) return "";
      return SIMPLE_ESCAPES.get(escape) ?? escape;
    },
  );
}

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (entity, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES.get(name) ?? entity;
  });
}

/** Drops surrounding blank lines and the indentation a template literal inherits from its test. */
function normalizeCode(code: string): string {
  const lines = code.replace(/\s+$/, "").split("\n");
  while (lines[0]?.trim() === "") lines.shift();
  const indent = Math.min(
    ...lines.filter((line) => line.trim() !== "").map((line) => /^\s*/.exec(line)?.[0].length ?? 0),
  );
  return lines.map((line) => line.slice(Number.isFinite(indent) ? indent : 0)).join("\n");
}

function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed());
}
