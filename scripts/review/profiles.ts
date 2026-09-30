import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bareName } from "./rules.ts";
import {
  SEVERITIES,
  type CompiledProfile,
  type ProfileFile,
  type ProfileGap,
  type ReviewRule,
  type Severity,
} from "./types.ts";

const PROFILE_NAME = /^[a-z][a-z0-9-]*$/;
const VENDORED_PLUGIN = "anti-slop";
const CATEGORIES_OFF = {
  correctness: "off",
  nursery: "off",
  pedantic: "off",
  perf: "off",
  restriction: "off",
  style: "off",
  suspicious: "off",
};

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
  if (input.severity === null) delete rules[input.ruleKey];
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

export function compileProfiles(
  profiles: Map<string, ProfileFile>,
  rules: ReviewRule[],
): CompiledProfile[] {
  const rulesByKey = new Map(rules.map((rule) => [rule.key, rule]));
  return [...profiles.keys()].map((name) => compileProfile(name, profiles, rulesByKey));
}

function compileProfile(
  name: string,
  profiles: Map<string, ProfileFile>,
  rulesByKey: Map<string, ReviewRule>,
): CompiledProfile {
  const profile = profiles.get(name);
  if (!profile) throw new Error(`Unknown profile: ${name}`);
  const resolved = resolveRules(name, profiles, []);
  const plugins = new Set<string>();
  const oxlintRules: { [ruleId: string]: unknown } = {};
  const astGrepRules = new Set<string>();
  const gaps: ProfileGap[] = [];
  let usesVendoredPlugin = false;

  for (const [ruleKey, severity] of Object.entries(resolved)) {
    const rule = rulesByKey.get(ruleKey);
    if (!rule) {
      gaps.push({ ruleKey, reason: "No longer in the discovery catalog." });
      continue;
    }
    const delivery = rule.delivery;
    if (delivery.kind === "first-party") {
      for (const path of delivery.astGrepRules) astGrepRules.add(path);
      for (const [ruleId, value] of Object.entries(delivery.oxlintRules)) {
        oxlintRules[ruleId] = withSeverity(value, severity);
        const plugin = ruleId.includes("/") ? ruleId.split("/")[0] : "eslint";
        if (plugin) plugins.add(plugin);
      }
    } else if (delivery.kind === "native") {
      oxlintRules[delivery.ruleId] = severity;
      plugins.add(delivery.plugin);
    } else if (delivery.kind === "vendor-oxlint" || delivery.kind === "vendor-ast-grep") {
      const sighting = rule.sightings.find(({ id }) => id === delivery.candidateId);
      const bare = bareName(rule.name);
      if (delivery.kind === "vendor-oxlint") {
        oxlintRules[`${VENDORED_PLUGIN}/${bare}`] = severity;
        usesVendoredPlugin = true;
      } else {
        astGrepRules.add(`ast-grep/rules/${bare}.yml`);
      }
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
    ...(usesVendoredPlugin ? { jsPlugins: [`./plugins/${VENDORED_PLUGIN}.js`] } : {}),
    categories: CATEGORIES_OFF,
    rules: Object.fromEntries(
      Object.entries(oxlintRules).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
  const astGrep = [...astGrepRules].sort();

  return {
    name,
    description: profile.description,
    extends: profile.extends ?? [],
    own: profile.rules,
    resolved,
    oxlintConfig: `${JSON.stringify(config, null, 2)}\n`,
    astGrepRules: astGrep,
    install: renderInstall(name, astGrep.length > 0),
    gaps,
  };
}

/** Flattens `extends` depth-first so a profile's own severities override inherited ones. */
function resolveRules(
  name: string,
  profiles: Map<string, ProfileFile>,
  trail: string[],
): { [ruleKey: string]: Severity } {
  if (trail.includes(name)) throw new Error(`Profile cycle: ${[...trail, name].join(" -> ")}`);
  const profile = profiles.get(name);
  if (!profile) throw new Error(`Unknown profile: ${name}`);
  const inherited = (profile.extends ?? []).map((base) =>
    resolveRules(base, profiles, [...trail, name]),
  );
  return Object.assign({}, ...inherited, profile.rules);
}

function withSeverity(value: unknown, severity: Severity): unknown {
  if (Array.isArray(value)) return [severity, ...value.slice(1)];
  return severity;
}

function renderInstall(name: string, hasAstGrep: boolean): CompiledProfile["install"] {
  const scripts = {
    "lint:oxlint": "oxlint --config tools/oxlint/.oxlintrc.json .",
    ...(hasAstGrep ? { "lint:ast": "ast-grep scan --config tools/ast-grep/sgconfig.yml ." } : {}),
  };
  return {
    commands: `# Copy the profile into tools/. Re-run to resync, or add --diff to preview changes.
bunx --bun shadcn@latest add austinm911/anti-slop/${name}

# Pin a release instead of following main.
bunx --bun shadcn@latest add austinm911/anti-slop/${name}#v0.1.0
`,
    scripts: `${JSON.stringify({ scripts }, null, 2)}\n`,
  };
}
