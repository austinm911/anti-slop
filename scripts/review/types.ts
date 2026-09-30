import type { ArtifactKind, RuleCandidate } from "../discovery/types.ts";
import type { ECOSYSTEMS } from "./taxonomy.ts";

export const REVIEW_ACTIONS = ["keep", "reject", "defer", "reopen"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const REVIEW_STATUSES = ["unreviewed", "kept", "deferred", "rejected", "shipped"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const SEVERITIES = ["error", "warn"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type Ecosystem = keyof typeof ECOSYSTEMS;

export type TaxonomyPath = {
  domain: string;
  category: string;
};

export type ReviewEvent = {
  eventId: string;
  ruleKey: string;
  revision: string;
  action: ReviewAction;
  rationale: string;
  createdAt: string;
};

/** How a rule reaches a consumer's lint configuration once a profile includes it. */
export type Delivery =
  | {
      kind: "first-party";
      tier: "correctness" | "preference";
      astGrepRules: string[];
      oxlintRules: { [ruleId: string]: unknown };
    }
  /** `fix` is the `oxlint --rules` fix capability, such as `fixable_fix` or `none`. */
  | { kind: "native"; ruleId: string; plugin: string; docsUrl: string; fix: string }
  | { kind: "vendor-oxlint"; candidateId: string }
  | { kind: "vendor-ast-grep"; candidateId: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "guidance" };

/** One snippet a rule reports or accepts. `fixed` is the autofix output when a test records it. */
export type RuleExample = { code: string; fixed?: string };

/** Examples recovered from one upstream docs page or test file. */
export type ExampleSet = {
  origin: "oxlint-docs" | "rule-tester" | "ast-grep-test" | "bun-test";
  label: string;
  url: string;
  breaks: RuleExample[];
  passes: RuleExample[];
};

export type Classification = {
  input: string;
  domain: string;
  category: string;
  ecosystem: Ecosystem;
  projectSpecific: number;
  confidence: { domain: number; category: number; ecosystem: number };
};

export type ClassificationCache = {
  model: string;
  rules: { [ruleKey: string]: Classification };
};

/** A sighting is one candidate from one source. The first-party origin marks this repository's own rules. */
export type Sighting = RuleCandidate & { origin: "first-party" | "upstream" };

export type RuleReview = {
  status: ReviewStatus;
  rationale?: string;
  updatedAt?: string;
  /** The rule changed upstream after the decision was recorded. */
  stale: boolean;
};

export type ReviewRule = {
  key: string;
  name: string;
  description: string;
  kinds: ArtifactKind[];
  sources: string[];
  sightings: Sighting[];
  revision: string;
  delivery: Delivery;
  taxonomy: TaxonomyPath;
  ecosystem: Ecosystem | "unsorted";
  projectSpecific?: number;
  classified: boolean;
  testCoverage: "none" | "linked" | "dedicated";
  review: RuleReview;
  profiles: string[];
};

export type ProfileFile = {
  description: string;
  extends?: string[];
  rules: { [ruleKey: string]: Severity };
};

export type ProfileGap = { ruleKey: string; reason: string };

export type CompiledProfile = {
  name: string;
  description: string;
  extends: string[];
  /** Rules this profile lists directly, excluding inherited ones. */
  own: { [ruleKey: string]: Severity };
  /** Every rule after resolving `extends`. */
  resolved: { [ruleKey: string]: Severity };
  oxlintConfig: string;
  astGrepRules: string[];
  install: { commands: string; scripts: string };
  gaps: ProfileGap[];
};

export type ReviewState = {
  generatedAt: string;
  catalogGeneratedAt: string;
  classificationModel?: string;
  rules: ReviewRule[];
  profiles: CompiledProfile[];
  counts: { [status in ReviewStatus]: number } & { total: number };
};
