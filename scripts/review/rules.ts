import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAll } from "js-yaml";
import type { RuleCandidate } from "../discovery/types.ts";
import { findPlugin, pluginSpecifier, type LoadedPlugin } from "./plugins.ts";
import type { Delivery, Sighting } from "./types.ts";

export const FIRST_PARTY_REPOSITORY = "austinm911/anti-slop";

export type NativeRule = { plugin: string; name: string; docsUrl: string; fix: string };

/** Oxlint config plugin names differ from the scope names `oxlint --rules` reports. */
const CONFIG_PLUGIN_NAMES: { [scope: string]: string } = {
  jsx_a11y: "jsx-a11y",
  react_perf: "react-perf",
};

/** Upstream configs often use ESLint plugin names that Oxlint ports under another scope. */
const SCOPE_ALIASES: { [scope: string]: string } = {
  "@typescript-eslint": "typescript",
  "typescript-eslint": "typescript",
  "react-hooks": "react",
  "jsx-a11y": "jsx_a11y",
  "react-perf": "react_perf",
  "import-x": "import",
  n: "node",
};

export async function loadNativeRules(oxlintBinary: string): Promise<Map<string, NativeRule>> {
  const process = Bun.spawn([oxlintBinary, "--rules", "--format=json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error("Could not list native Oxlint rules");
  const rules = JSON.parse(stdout) as Array<{
    scope: string;
    value: string;
    docs_url: string;
    fix: string;
  }>;
  return new Map(
    rules.map(({ scope, value, docs_url, fix }) => [
      `${scope}/${value}`,
      { plugin: scope, name: value, docsUrl: docs_url, fix },
    ]),
  );
}

/**
 * Loads this repository's published rules from the registry so they appear beside upstream
 * candidates and profiles can include them.
 */
export async function loadFirstPartySightings(root: string): Promise<Sighting[]> {
  const registry = JSON.parse(await readFile(join(root, "registry.json"), "utf8")) as {
    items: Array<{ name: string; description: string; files?: Array<{ path: string }> }>;
  };
  const commit = (await Bun.$`git -C ${root} rev-parse HEAD`.text()).trim();
  const sightings: Sighting[] = [];
  for (const item of registry.items) {
    const paths = (item.files ?? []).map(({ path }) => path);
    const ruleFiles = paths.filter((path) => /^ast-grep\/(rules|preferences)\/.+\.yml$/.test(path));
    const ownsOxlint = paths.includes("oxlint/.oxlintrc.json");
    if (ruleFiles.length === 0 && !ownsOxlint) continue;
    const primary = ruleFiles.find((path) => path.endsWith(`/${item.name}.yml`));
    const message = primary ? await ruleMessage(join(root, primary)) : undefined;
    const content = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
    sightings.push({
      id: `first-party:${item.name}`,
      name: item.name,
      description: message ?? item.description,
      source: { repository: FIRST_PARTY_REPOSITORY, ref: "main", commit, paths, license: "MIT" },
      artifact: {
        kind: ownsOxlint ? "oxlint-policy" : "ast-grep-rule",
        sourceRuleName: item.name,
        implementationPaths: ownsOxlint ? ["oxlint/.oxlintrc.json", ...ruleFiles] : ruleFiles,
        testPaths: paths.filter((path) => /(rule|preference)-tests\/|test\.mjs$/.test(path)),
      },
      fingerprint: new Bun.CryptoHasher("sha256").update(content.join("\0")).digest("hex"),
      admission: {
        classification: paths.some((path) => path.startsWith("ast-grep/preferences/"))
          ? "preference-candidate"
          : "correctness-candidate",
        failedConditions: [],
      },
      similarity: { exactDuplicates: [], relatedCandidates: [] },
      origin: "first-party",
    });
  }
  return sightings;
}

async function ruleMessage(path: string): Promise<string | undefined> {
  const [parsed] = loadAll(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const message = Reflect.get(parsed, "message");
  return typeof message === "string" ? message : undefined;
}

/**
 * Groups sightings that name the same rule. Configured rule IDs drop their plugin scope, so
 * `typescript/no-unused-vars` in one config and `no-unused-vars` in another become one rule.
 * Guidance stays per source because two repositories' prose rarely says the same thing.
 */
export function ruleKey(candidate: RuleCandidate): string {
  if (candidate.artifact.kind === "agent-guidance") {
    return `guidance:${candidate.source.repository}:${candidate.name}`;
  }
  return `rule:${bareName(candidate.artifact.sourceRuleName ?? candidate.name)}`;
}

export function bareName(ruleId: string): string {
  return ruleId.split("/").at(-1) ?? ruleId;
}

export function resolveNativeRule(
  ruleId: string,
  nativeRules: Map<string, NativeRule>,
): NativeRule | undefined {
  const parts = ruleId.split("/");
  const name = parts.at(-1) ?? ruleId;
  const scope = parts.length === 1 ? "eslint" : parts.slice(0, -1).join("/");
  return nativeRules.get(`${SCOPE_ALIASES[scope] ?? scope}/${name}`);
}

export function nativeConfigId(rule: NativeRule): string {
  if (rule.plugin === "eslint") return rule.name;
  return `${CONFIG_PLUGIN_NAMES[rule.plugin] ?? rule.plugin}/${rule.name}`;
}

export function nativeConfigPlugin(rule: NativeRule): string {
  return CONFIG_PLUGIN_NAMES[rule.plugin] ?? rule.plugin;
}

/**
 * Chooses how a grouped rule ships. First-party rules keep their files. A native Oxlint rule is
 * configuration. A rule in a plugin this package loads ships through `jsPlugins`. Anything else
 * must be vendored into this repository, preferring the implementation with the most tests, and
 * only a licensed implementation can be.
 */
export function chooseDelivery(
  sightings: Sighting[],
  nativeRules: Map<string, NativeRule>,
  oxlintRules: { [ruleId: string]: unknown },
  plugins: LoadedPlugin[],
): Delivery {
  const firstParty = sightings.find(({ origin }) => origin === "first-party");
  if (firstParty) {
    const astGrepRules = firstParty.source.paths.filter((path) =>
      /^ast-grep\/(rules|preferences)\//.test(path),
    );
    return {
      kind: "first-party",
      tier:
        firstParty.admission.classification === "preference-candidate"
          ? "preference"
          : "correctness",
      astGrepRules,
      oxlintRules: firstParty.artifact.kind === "oxlint-policy" ? oxlintRules : {},
    };
  }
  if (sightings.every(({ artifact }) => artifact.kind === "agent-guidance")) {
    return { kind: "guidance" };
  }
  for (const sighting of sightings) {
    if (sighting.artifact.kind !== "oxlint-policy") continue;
    const native = resolveNativeRule(
      sighting.artifact.sourceRuleName ?? sighting.name,
      nativeRules,
    );
    if (native) {
      return {
        kind: "native",
        ruleId: nativeConfigId(native),
        plugin: nativeConfigPlugin(native),
        docsUrl: native.docsUrl,
        fix: native.fix,
      };
    }
  }
  const byTests = [...sightings].sort(
    (left, right) => right.artifact.testPaths.length - left.artifact.testPaths.length,
  );
  for (const sighting of byTests) {
    if (sighting.artifact.kind !== "oxlint-plugin-rule") continue;
    const name = bareName(sighting.artifact.sourceRuleName ?? sighting.name);
    const path = sighting.artifact.implementationPaths[0] ?? "";
    const plugin = findPlugin(plugins, sighting.source.repository, path, name);
    if (plugin) {
      return {
        kind: "plugin",
        ruleId: `${plugin.name}/${name}`,
        specifier: pluginSpecifier(plugin.source),
        candidateId: sighting.id,
      };
    }
  }
  const isImplementation = ({ artifact }: Sighting) =>
    artifact.kind === "oxlint-plugin-rule" || artifact.kind === "ast-grep-rule";
  const licensed = byTests.filter(({ source }) => source.license);
  const unlicensed = byTests.find(
    (sighting) => isImplementation(sighting) && !sighting.source.license,
  );
  if (unlicensed && !licensed.some(isImplementation)) {
    return {
      kind: "unsupported",
      reason: `${unlicensed.source.repository} has no license, so its implementation can't be redistributed.`,
    };
  }
  const oxlint = licensed.find(({ artifact }) => artifact.kind === "oxlint-plugin-rule");
  if (oxlint) return { kind: "vendor-oxlint", candidateId: oxlint.id };
  const astGrep = licensed.find(({ artifact }) => artifact.kind === "ast-grep-rule");
  if (astGrep) return { kind: "vendor-ast-grep", candidateId: astGrep.id };
  if (sightings.some(({ artifact }) => artifact.kind === "oxlint-policy")) {
    return {
      kind: "unsupported",
      reason: "Configured in a third-party plugin whose implementation discovery did not find.",
    };
  }
  return {
    kind: "unsupported",
    reason: "Runs in a type-aware or workspace runner that Oxlint cannot load.",
  };
}
