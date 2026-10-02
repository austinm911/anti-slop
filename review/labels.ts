import type { ArtifactKind } from "../scripts/discovery/types.ts";
import type {
  Delivery,
  ExampleSet,
  ReviewRule,
  ReviewState,
  ReviewStatus,
} from "../scripts/review/types.ts";

export const STATUS_FILTERS: Array<{ id: ReviewStatus | "all"; label: string; key?: string }> = [
  { id: "unreviewed", label: "Inbox" },
  { id: "kept", label: "Kept" },
  { id: "deferred", label: "Deferred" },
  { id: "rejected", label: "Rejected" },
  { id: "shipped", label: "Shipped" },
  { id: "all", label: "All" },
];

export const DELIVERY_LABELS: { [kind in Delivery["kind"]]: string } = {
  "first-party": "Ships from this repo",
  native: "Native Oxlint",
  plugin: "Oxlint plugin rule",
  "vendor-oxlint": "Vendor Oxlint rule",
  "vendor-ast-grep": "Vendor ast-grep rule",
  unsupported: "Can't lint yet",
  guidance: "Agent guidance",
};

export const EXAMPLE_ORIGIN_LABELS: { [origin in ExampleSet["origin"]]: string } = {
  authored: "hand-written",
  "oxlint-docs": "docs",
  "rule-tester": "RuleTester cases",
  "ast-grep-test": "ast-grep tests",
  "bun-test": "fixture tests, sorted by assertions",
};

/** Reads `oxlint --rules` fix capabilities such as `conditional_dangerous_fix_or_suggestion`. */
export function fixLabel(fix: string): string {
  if (fix === "none") return "No auto-fix";
  if (fix === "pending") return "Auto-fix planned";
  const [, when, safety, what] =
    /^(conditional|fixable)_(?:(safe|dangerous)_)?(fix_or_suggestion|fix|suggestion)$/.exec(fix) ??
    [];
  if (!what) return fix;
  return `${what === "suggestion" ? "Suggested fix" : "Auto-fix"}${safety === "dangerous" ? ", unsafe" : ""}${when === "conditional" ? ", some cases" : ""}`;
}

export const KIND_LABELS: { [kind in ArtifactKind]: string } = {
  "ast-grep-rule": "ast-grep",
  "oxlint-plugin-rule": "plugin rule",
  "oxlint-policy": "config",
  "typed-check": "typed check",
  "workspace-check": "workspace check",
  "agent-guidance": "guidance",
};

export const ECOSYSTEM_LABELS: { [ecosystem in ReviewRule["ecosystem"]]: string } = {
  any_typescript: "Any TypeScript",
  effect: "Effect",
  react: "React",
  xstate: "XState",
  zod: "Zod",
  node_bun: "Node / Bun",
  nix: "Nix",
  other: "Other library",
  unsorted: "Unsorted",
};

export const GROUPINGS = [
  { id: "domain", label: "Domain" },
  { id: "source", label: "Source" },
  { id: "ecosystem", label: "Ecosystem" },
  { id: "delivery", label: "Delivery" },
] as const;

export type Grouping = (typeof GROUPINGS)[number]["id"];

/** The facet values a rule belongs to. A rule seen in two repositories counts under both. */
export function facetValues(rule: ReviewRule, grouping: Grouping): string[] {
  if (grouping === "domain") return [rule.taxonomy.domain];
  if (grouping === "source") return rule.sources;
  if (grouping === "ecosystem") return [ECOSYSTEM_LABELS[rule.ecosystem]];
  return [DELIVERY_LABELS[rule.delivery.kind]];
}

export function facetCounts(rules: ReviewRule[], grouping: Grouping): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const rule of rules) {
    for (const value of facetValues(rule, grouping))
      counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort(
    ([left, leftCount], [right, rightCount]) =>
      Number(left === "Unsorted") - Number(right === "Unsorted") ||
      rightCount - leftCount ||
      left.localeCompare(right),
  );
}

export function statusCount(state: ReviewState, status: ReviewStatus | "all"): number {
  return status === "all" ? state.counts.total : state.counts[status];
}

export function shortRepository(repository: string): string {
  return repository.split("/").at(-1) ?? repository;
}
