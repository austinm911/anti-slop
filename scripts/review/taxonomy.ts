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

export const UNSORTED = { domain: "Unsorted", category: "Unsorted" } as const;

/** Libraries or runtimes a rule depends on. Profiles such as `effect` select by this. */
export const ECOSYSTEMS = {
  any_typescript: "Applies to any JavaScript or TypeScript codebase",
  effect: "Effect (effect-ts) programs, such as Effect.gen, Layer, Schema, or Context",
  react: "React components, hooks, or JSX",
  xstate: "XState state machines and actors",
  zod: "Zod schemas",
  node_bun: "Node.js or Bun runtime APIs",
  nix: "Nix configuration",
  other: "Another specific library, framework, or tool",
} as const;

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
