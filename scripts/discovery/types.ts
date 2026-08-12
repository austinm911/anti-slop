export const ARTIFACT_KINDS = [
  "ast-grep-rule",
  "oxlint-plugin-rule",
  "oxlint-policy",
  "typed-check",
  "workspace-check",
  "agent-guidance",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const CLASSIFICATIONS = [
  "unreviewed",
  "correctness-candidate",
  "preference-candidate",
  "native-policy",
  "native-duplicate",
  "project-specific",
  "rejected",
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

export const REQUIRED_ANALYSIS = [
  "syntax",
  "scope",
  "control-flow",
  "type-information",
  "workspace",
] as const;

export type RequiredAnalysis = (typeof REQUIRED_ANALYSIS)[number];

export type SourceSpec = {
  repo: string;
  ref: string;
};

export type SourceManifest = {
  repositories: SourceSpec[];
};

export type CandidateAnalysis = {
  summary: string;
  defect: string;
  remediation: string;
  applicability: string[];
  dependencies: string[];
  exceptions: string[];
  requiredAnalysis: RequiredAnalysis;
  proposedOwner: "ast-grep" | "oxlint" | "other";
};

export type RuleCandidate = {
  id: string;
  name: string;
  description: string;
  source: {
    repository: string;
    ref: string;
    commit: string;
    paths: string[];
    license?: string;
  };
  artifact: {
    kind: ArtifactKind;
    sourceRuleName?: string;
    implementationPaths: string[];
    testPaths: string[];
  };
  fingerprint: string;
  analysis?: CandidateAnalysis;
  admission: {
    classification: Classification;
    failedConditions: string[];
    confidence?: number;
  };
  similarity: {
    exactDuplicates: string[];
    relatedCandidates: string[];
  };
};

export type CandidateCatalog = {
  schemaVersion: 1;
  generatedAt: string;
  sources: Array<{
    repository: string;
    ref: string;
    commit: string;
  }>;
  candidates: RuleCandidate[];
};

export type AgentKind = "none" | "omp" | "pi";

export type AgentAssessment = {
  id: string;
  summary: string;
  defect: string;
  remediation: string;
  applicability: string[];
  dependencies: string[];
  exceptions: string[];
  requiredAnalysis: RequiredAnalysis;
  proposedOwner: "ast-grep" | "oxlint" | "other";
  classification: Exclude<Classification, "unreviewed" | "native-policy">;
  failedConditions: string[];
  confidence: number;
};
