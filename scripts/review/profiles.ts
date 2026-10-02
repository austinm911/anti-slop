import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIRST_PARTY_REPOSITORY } from "./rules.ts";
import {
  OXLINT_CATEGORIES,
  SEVERITIES,
  type CompiledProfile,
  type ProfileCategories,
  type ProfileFile,
  type ProfileGap,
  type ReviewRule,
  type RuleSetting,
  type Severity,
} from "./types.ts";

const PROFILE_NAME = /^[a-z][a-z0-9-]*$/;
export const PACKAGE_NAME = "@austinm911/anti-slop";
/**
 * Oxlint's default plugins. An explicit `plugins` list replaces the defaults, so a profile that
 * enables a category names them to keep the category's rules from those plugins.
 */
const DEFAULT_PLUGINS = ["eslint", "oxc", "typescript", "unicorn"];

export async function loadProfiles(directory: string): Promise<Map<string, ProfileFile>> {
  const entries = await readdir(directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const profiles = new Map<string, ProfileFile>();
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const profile = JSON.parse(await readFile(join(directory, entry), "utf8")) as ProfileFile;
    profiles.set(entry.slice(0, -".json".length), profile);
  }
  return profiles;
}

export async function createProfile(
  directory: string,
  input: { name: string; description: string; extends: string[] },
): Promise<void> {
  if (!PROFILE_NAME.test(input.name)) {
    throw new Error("Profile names use lowercase letters, digits, and hyphens");
  }
  const profiles = await loadProfiles(directory);
  if (profiles.has(input.name)) throw new Error(`Profile already exists: ${input.name}`);
  const unknown = input.extends.filter((name) => !profiles.has(name));
  if (unknown.length > 0) throw new Error(`Unknown base profile: ${unknown.join(", ")}`);
  await writeProfile(directory, input.name, {
    description: input.description.trim(),
    ...(input.extends.length > 0 ? { extends: input.extends } : {}),
    rules: {},
  });
}

/** Adds, updates, or removes (with `null`) one rule in a profile's own rule list. */
export async function setProfileRule(
  directory: string,
  input: { profile: string; ruleKey: string; severity: Severity | null },
): Promise<void> {
  const profile = (await loadProfiles(directory)).get(input.profile);
  if (!profile) throw new Error(`Unknown profile: ${input.profile}`);
  if (input.severity !== null && !SEVERITIES.includes(input.severity)) {
    throw new Error(`Invalid severity: ${input.severity}`);
  }
  const rules = { ...profile.rules };
  const current = rules[input.ruleKey];
  if (input.severity === null) delete rules[input.ruleKey];
  else if (Array.isArray(current)) rules[input.ruleKey] = [input.severity, ...current.slice(1)];
  else rules[input.ruleKey] = input.severity;
  await writeProfile(directory, input.profile, { ...profile, rules });
}

async function writeProfile(directory: string, name: string, profile: ProfileFile): Promise<void> {
  await mkdir(directory, { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(profile.rules).sort(([left], [right]) => left.localeCompare(right)),
  );
  await writeFile(
    join(directory, `${name}.json`),
    `${JSON.stringify({ ...profile, rules: sorted }, null, 2)}\n`,
  );
}

/** One ast-grep config and the rule files it runs. ast-grep scans a whole rule directory. */
export type AstGrepConfig = { config: string; rules: string[] };

export function compileProfiles(
  profiles: Map<string, ProfileFile>,
  rules: ReviewRule[],
  astGrepConfigs: AstGrepConfig[],
): CompiledProfile[] {
  const rulesByKey = new Map(rules.map((rule) => [rule.key, rule]));
  return [...profiles.keys()].map((name) =>
    compileProfile(name, profiles, rulesByKey, astGrepConfigs),
  );
}

export function severityOf(setting: RuleSetting): Severity {
  return Array.isArray(setting) ? setting[0] : setting;
}

function compileProfile(
  name: string,
  profiles: Map<string, ProfileFile>,
  rulesByKey: Map<string, ReviewRule>,
  astGrepConfigs: AstGrepConfig[],
): CompiledProfile {
  const profile = profiles.get(name);
  if (!profile) throw new Error(`Unknown profile: ${name}`);
  const resolved = resolveRules(name, profiles, []);
  const categories = resolveCategories(name, profiles);
  const plugins = new Set<string>(Object.keys(categories).length > 0 ? DEFAULT_PLUGINS : []);
  const jsPlugins = new Set<string>();
  const oxlintRules: { [ruleId: string]: unknown } = {};
  const astGrepRules = new Set<string>();
  const gaps: ProfileGap[] = [];
  const sources = new Map<string, number>();
  const count = (source: string) => sources.set(source, (sources.get(source) ?? 0) + 1);

  for (const [ruleKey, setting] of Object.entries(resolved)) {
    const rule = rulesByKey.get(ruleKey);
    if (!rule) {
      gaps.push({ ruleKey, reason: "No longer in the discovery catalog." });
      continue;
    }
    const delivery = rule.delivery;
    if (delivery.kind === "first-party") {
      count(FIRST_PARTY_REPOSITORY);
      for (const path of delivery.astGrepRules) astGrepRules.add(path);
      const configured = Object.entries(delivery.oxlintRules);
      for (const [ruleId, value] of configured) {
        // A profile's options belong to one rule, so they apply only when the delivery has one.
        oxlintRules[ruleId] =
          Array.isArray(setting) && configured.length === 1
            ? setting
            : withSeverity(value, severityOf(setting));
        const plugin = ruleId.includes("/") ? ruleId.split("/")[0] : "eslint";
        if (plugin) plugins.add(plugin);
      }
    } else if (delivery.kind === "native") {
      count("Oxlint native");
      oxlintRules[delivery.ruleId] = upstreamSetting(rule, setting, gaps);
      plugins.add(delivery.plugin);
    } else if (delivery.kind === "plugin") {
      count(
        rule.sightings.find(({ id }) => id === delivery.candidateId)?.source.repository ??
          delivery.specifier,
      );
      oxlintRules[delivery.ruleId] = upstreamSetting(rule, setting, gaps);
      jsPlugins.add(delivery.specifier);
    } else if (delivery.kind === "vendor-oxlint" || delivery.kind === "vendor-ast-grep") {
      const sighting = rule.sightings.find(({ id }) => id === delivery.candidateId);
      gaps.push({
        ruleKey,
        reason: `Vendor ${sighting?.artifact.implementationPaths[0] ?? "the implementation"} from ${sighting?.source.repository ?? "upstream"}@${sighting?.source.commit.slice(0, 7) ?? "?"} with its tests before publishing.`,
      });
    } else if (delivery.kind === "unsupported") {
      gaps.push({ ruleKey, reason: delivery.reason });
    } else {
      gaps.push({ ruleKey, reason: "Agent guidance is prose, not a lint rule." });
    }
  }

  const config = {
    plugins: [...plugins].sort(),
    ...(jsPlugins.size > 0 ? { jsPlugins: [...jsPlugins].sort() } : {}),
    categories: Object.fromEntries(
      OXLINT_CATEGORIES.map((category) => [category, categories[category] ?? "off"]),
    ),
    rules: Object.fromEntries(
      Object.entries(oxlintRules).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
  const astGrep = [...astGrepRules].sort();
  const configs = astGrepConfigs.filter(({ rules }) =>
    rules.some((path) => astGrepRules.has(path)),
  );
  for (const { config: path, rules } of configs) {
    const missing = rules.filter((rule) => !astGrepRules.has(rule));
    if (missing.length === 0) continue;
    gaps.push({
      ruleKey: `ast-grep:${path}`,
      reason: `${path} runs every rule in its directory, including ${missing.join(", ")}, which this profile leaves out.`,
    });
  }

  return {
    name,
    description: profile.description,
    extends: profile.extends ?? [],
    own: severities(profile.rules),
    resolved: severities(resolved),
    categories,
    sources: [...sources]
      .map(([source, rules]) => ({ source, rules }))
      .sort((left, right) => right.rules - left.rules || left.source.localeCompare(right.source)),
    oxlintConfig: `${JSON.stringify(config, null, 2)}\n`,
    astGrepConfigs: configs.map(({ config: path }) => path),
    astGrepRules: astGrep,
    install: renderInstall(
      name,
      configs.map(({ config: path }) => path),
    ),
    gaps,
  };
}

/**
 * A bare severity takes the options the upstream sources configure. When sources disagree,
 * including one that runs the defaults, the rule runs with defaults and the profile must choose.
 */
function upstreamSetting(rule: ReviewRule, setting: RuleSetting, gaps: ProfileGap[]): unknown {
  if (Array.isArray(setting)) return setting;
  const configured = new Map<string, { options: unknown[]; sources: Set<string> }>();
  for (const { artifact, source } of rule.sightings) {
    if (!artifact.options) continue;
    const key = stableJson(artifact.options);
    const entry = configured.get(key) ?? { options: artifact.options, sources: new Set() };
    entry.sources.add(source.repository);
    configured.set(key, entry);
  }
  const [only, ...others] = configured.values();
  if (!only) return setting;
  if (others.length === 0) return only.options.length > 0 ? [setting, ...only.options] : setting;
  gaps.push({
    ruleKey: rule.key,
    reason: `Sources configure different options (${[only, ...others].map(({ sources }) => [...sources].join(", ")).join(" vs ")}). Set them in the profile.`,
  });
  return setting;
}

/** JSON with object keys sorted, so option sets that differ only in key order compare equal. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, nested: unknown) =>
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)),
        )
      : nested,
  );
}

function severities(rules: { [ruleKey: string]: RuleSetting }): { [ruleKey: string]: Severity } {
  return Object.fromEntries(
    Object.entries(rules).map(([ruleKey, setting]) => [ruleKey, severityOf(setting)]),
  );
}

/** Flattens `extends` depth-first so a profile's own severities override inherited ones. */
function resolveRules(
  name: string,
  profiles: Map<string, ProfileFile>,
  trail: string[],
): { [ruleKey: string]: RuleSetting } {
  if (trail.includes(name)) throw new Error(`Profile cycle: ${[...trail, name].join(" -> ")}`);
  const profile = profiles.get(name);
  if (!profile) throw new Error(`Unknown profile: ${name}`);
  const inherited = (profile.extends ?? []).map((base) =>
    resolveRules(base, profiles, [...trail, name]),
  );
  return Object.assign({}, ...inherited, profile.rules);
}

function resolveCategories(name: string, profiles: Map<string, ProfileFile>): ProfileCategories {
  const profile = profiles.get(name);
  if (!profile) throw new Error(`Unknown profile: ${name}`);
  const inherited = (profile.extends ?? []).map((base) => resolveCategories(base, profiles));
  return Object.assign({}, ...inherited, profile.categories);
}

function withSeverity(value: unknown, severity: Severity): unknown {
  if (Array.isArray(value)) return [severity, ...value.slice(1)];
  return severity;
}

function renderInstall(name: string, astGrepConfigs: string[]): CompiledProfile["install"] {
  const scripts = {
    lint: "oxlint .",
    ...Object.fromEntries(
      astGrepConfigs.map((config, index) => [
        index === 0 ? "lint:ast" : `lint:ast:${index + 1}`,
        `ast-grep scan --config node_modules/${PACKAGE_NAME}/${config} .`,
      ]),
    ),
  };
  return {
    commands: `bun add -D -E oxlint ${PACKAGE_NAME}${astGrepConfigs.length > 0 ? " @ast-grep/cli" : ""}

# .oxlintrc.json
${JSON.stringify({ extends: [`./node_modules/${PACKAGE_NAME}/oxlint/configs/${name}.json`], rules: {} }, null, 2)}
`,
    scripts: `${JSON.stringify({ scripts }, null, 2)}\n`,
  };
}
