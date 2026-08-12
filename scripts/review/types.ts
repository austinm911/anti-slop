import type { RuleCandidate } from "../discovery/types.ts";

export const REVIEW_ACTIONS = [
  "keep",
  "reject",
  "defer",
  "adopt",
  "adapt",
  "native",
  "merge",
  "reopen",
] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const REVIEW_STATUSES = ["unreviewed", "kept", "decided"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type TaxonomyPath = {
  domain: string;
  category: string;
};

export type ReviewEvent = {
  eventId: string;
  candidateId: string;
  candidateRevision: string;
  action: ReviewAction;
  rationale: string;
  createdAt: string;
  mergeTargetId?: string;
};

export type CandidateReview = {
  status: ReviewStatus;
  action?: ReviewAction;
  rationale?: string;
  updatedAt?: string;
  mergeTargetId?: string;
};

export type ReviewCandidate = RuleCandidate & {
  taxonomy: TaxonomyPath;
  review: CandidateReview;
  evidence: {
    testCoverage: "none" | "linked" | "dedicated";
    failedConditionCount: number;
  };
};

export type ReviewState = {
  generatedAt: string;
  catalogGeneratedAt: string;
  candidates: ReviewCandidate[];
  domains: Array<{
    domain: string;
    count: number;
    categories: Array<{ category: string; count: number }>;
  }>;
  counts: {
    total: number;
    unreviewed: number;
    kept: number;
    decided: number;
  };
};
