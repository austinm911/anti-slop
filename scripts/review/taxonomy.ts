import type { RuleCandidate } from "../discovery/types.ts";
import type { TaxonomyPath } from "./types.ts";

export const TAXONOMY = [
  {
    domain: "Type & Data Contracts",
    categories: [
      "Type evidence & escape hatches",
      "API signatures & inference",
      "Boundary decoding & serialization",
      "Schema semantics",
      "Schema API direction & evolution",
    ],
  },
  {
    domain: "Program Logic & Control Flow",
    categories: [
      "Branching & matching",
      "Nullability & collections",
      "Mutation & sequencing",
      "Redundant operations",
    ],
  },
  {
    domain: "Failures, Effects & I/O",
    categories: [
      "Failure channels",
      "Capabilities & nondeterminism",
      "Network, filesystem & storage",
      "Observability",
    ],
  },
  {
    domain: "Architecture & Ownership",
    categories: [
      "Dependency boundaries",
      "Services & provisioning",
      "Module & API surface",
      "Repository & asset ownership",
    ],
  },
  {
    domain: "State & Reactivity",
    categories: ["Machine construction", "State normalization", "Events & selectors", "Lifecycle"],
  },
  {
    domain: "UI & Presentation",
    categories: [
      "Layout & behavior",
      "Styling & tokens",
      "Components & primitives",
      "File conventions",
    ],
  },
  {
    domain: "Maintainability & Code Clarity",
    categories: [
      "Naming & visibility",
      "Scope & dead code",
      "Indirection & locality",
      "Documentation & readability",
    ],
  },
  {
    domain: "Security & Privacy",
    categories: ["Secrets & credentials", "Data minimization", "Sensitive configuration"],
  },
  {
    domain: "Engineering Process & Agent Operations",
    categories: [
      "Testing & verification",
      "Version control",
      "Build & dependencies",
      "Tool routing",
      "Agent policy",
    ],
  },
] as const;

type TaxonomyRule = {
  path: TaxonomyPath;
  matches: RegExp;
};

const RULES: TaxonomyRule[] = [
  {
    path: path(0, 0),
    matches: /assert|widen|erasure|unsafe-dictionary|banned-type|record-string-unknown/,
  },
  { path: path(0, 1), matches: /parameter|return-type|infer|generic-helper|multiple-function/ },
  {
    path: path(0, 2),
    matches: /json|typeof|validation|decode|encode|parse-argument|direct-fetch|browser-storage/,
  },
  {
    path: path(0, 3),
    matches: /schema|refinement|strict|optional-default|tool-input|constraint|issue-without-path/,
  },
  { path: path(0, 4), matches: /zod|literal-array|number-int|object-strict|typed-schema-api/ },
  { path: path(1, 0), matches: /switch|match|early-return|avoid-else/ },
  { path: path(1, 1), matches: /null|nullable|option|array-match|array-method/ },
  { path: path(1, 2), matches: /no-let|sequenc|pipe-max/ },
  { path: path(1, 3), matches: /empty|asvoid|require-yield|conditional.*spread/ },
  { path: path(2, 0), matches: /throw|try-catch|silent-error|failure|error-swallow/ },
  { path: path(2, 1), matches: /nondetermin|random|ambient-time|capabilit/ },
  { path: path(2, 2), matches: /fetch|storage|filesystem|bun-file|effect-platform/ },
  { path: path(2, 3), matches: /console|logg|observab/ },
  { path: path(3, 0), matches: /backend-import|repository-import|dependency-boundar/ },
  { path: path(3, 1), matches: /service|layer-provide|context-service/ },
  { path: path(3, 2), matches: /reexport|exporting|module|api-surface|single-use-private/ },
  { path: path(3, 3), matches: /tsx-in-ui|svg-file|asset-ownership|platform-module/ },
  { path: path(4, 0), matches: /create-machine/ },
  { path: path(4, 1), matches: /derived-boolean|state-normal/ },
  { path: path(4, 2), matches: /xstate.*event|selector|single-use-xstate/ },
  { path: path(4, 3), matches: /react-state-hook|multiple-xstate|exhaustive-deps|lifecycle/ },
  { path: path(5, 0), matches: /fixed-height|modal|menubarextra|layout/ },
  { path: path(5, 1), matches: /tailwind|css-module|jsx-style|classname|design-token/ },
  { path: path(5, 2), matches: /ui-primitive|img-element|component-export/ },
  { path: path(5, 3), matches: /route-layout|default-component|react-in-jsx|ui-folder/ },
  { path: path(6, 0), matches: /symbol-name|prefix|underscore|filename|naming/ },
  { path: path(6, 1), matches: /shadow|unused|dead-code|scope/ },
  { path: path(6, 2), matches: /single-use|inner-function|indirection|locality/ },
  {
    path: path(6, 3),
    matches: /comment|jsdoc|destructur|dot-notation|with-expression|readability/,
  },
  { path: path(7, 0), matches: /secret|credential|token/ },
  { path: path(7, 1), matches: /redact|data-minimi|privacy|copy-prompts/ },
  { path: path(7, 2), matches: /bitwarden|sensitive-config/ },
  { path: path(8, 0), matches: /mock|test-actual|verification/ },
  { path: path(8, 1), matches: /\bjj\b|version-control|change-scope/ },
  { path: path(8, 2), matches: /package-manager|devshell|nodejs|dependency|nix-package|fnm/ },
  { path: path(8, 3), matches: /readbro|rtk|grep|sqlite|diagnostic|tool-routing/ },
];

const FALLBACK = path(8, 4);

export function classifyCandidate(candidate: RuleCandidate): TaxonomyPath {
  const text = `${candidate.name} ${candidate.description}`.toLowerCase();
  return RULES.find(({ matches }) => matches.test(text))?.path ?? FALLBACK;
}

function path(domainIndex: number, categoryIndex: number): TaxonomyPath {
  const entry = TAXONOMY[domainIndex];
  const category = entry?.categories[categoryIndex];
  if (!entry || !category) throw new Error("Invalid taxonomy path definition");
  return { domain: entry.domain, category };
}
