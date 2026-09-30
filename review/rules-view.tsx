import { useEffect, useMemo, useState } from "react";
import type {
  ExampleSet,
  ReviewAction,
  ReviewRule,
  ReviewState,
  ReviewStatus,
} from "../scripts/review/types.ts";
import { CodeBlock, languageForPath } from "./highlight.tsx";
import {
  DELIVERY_LABELS,
  ECOSYSTEM_LABELS,
  EXAMPLE_ORIGIN_LABELS,
  facetCounts,
  fixLabel,
  facetValues,
  GROUPINGS,
  KIND_LABELS,
  shortRepository,
  STATUS_FILTERS,
  statusCount,
  type Grouping,
} from "./labels.ts";

type EvidenceFile = {
  repository: string;
  commit: string;
  path: string;
  content: string;
  available: boolean;
};

/** Upstream sets show a few cases each until the reviewer asks for the rest. */
const EXAMPLE_PREVIEW = 3;

/** Posts one write and adopts the returned state. Resolves false when the server rejected it. */
export type Mutate = (path: string, body: object) => Promise<boolean>;

const ACTION_BY_KEY: { [key: string]: ReviewAction } = {
  e: "keep",
  r: "reject",
  d: "defer",
  u: "reopen",
};

export function RulesView({
  state,
  mutate,
  busy,
}: {
  state: ReviewState;
  mutate: Mutate;
  busy: boolean;
}) {
  const [status, setStatus] = useState<ReviewStatus | "all">("unreviewed");
  const [grouping, setGrouping] = useState<Grouping>("domain");
  const [facet, setFacet] = useState<string>();
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>();
  const [rationale, setRationale] = useState("");

  const inStatus = useMemo(
    () => state.rules.filter((rule) => status === "all" || rule.review.status === status),
    [state, status],
  );
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = inStatus.filter(
      (rule) =>
        (!facet || facetValues(rule, grouping).includes(facet)) &&
        (needle.length === 0 ||
          `${rule.name} ${rule.description} ${rule.sources.join(" ")}`
            .toLowerCase()
            .includes(needle)),
    );
    const byGroup = new Map<string, ReviewRule[]>();
    for (const rule of visible) {
      const group = facet ?? facetValues(rule, grouping)[0] ?? "Unsorted";
      byGroup.set(group, [...(byGroup.get(group) ?? []), rule]);
    }
    const order = facetCounts(visible, grouping).map(([value]) => value);
    return [...byGroup].sort(([left], [right]) => order.indexOf(left) - order.indexOf(right));
  }, [facet, grouping, inStatus, query]);
  const ordered = useMemo(() => groups.flatMap(([, rules]) => rules), [groups]);

  const selected =
    ordered.find(({ key }) => key === selectedKey) ??
    state.rules.find(({ key }) => key === selectedKey) ??
    ordered[0];

  useEffect(() => setRationale(selected?.review.rationale ?? ""), [selected?.key]);

  async function decide(action: ReviewAction) {
    if (!selected || busy || selected.review.status === "shipped") return;
    const index = ordered.findIndex(({ key }) => key === selected.key);
    const next = ordered[index + 1] ?? ordered[index - 1];
    const saved = await mutate("/api/review", { ruleKey: selected.key, action, rationale });
    // A decision moves the rule out of the current queue, so advance to its neighbour.
    if (saved && status !== "all" && action !== "reopen") setSelectedKey(next?.key);
  }

  async function toggleProfile(profileName: string) {
    if (!selected) return;
    const profile = state.profiles.find(({ name }) => name === profileName);
    if (!profile || (!(selected.key in profile.own) && selected.key in profile.resolved)) return;
    await mutate("/api/profile-rule", {
      profile: profileName,
      ruleKey: selected.key,
      severity: selected.key in profile.own ? null : "error",
    });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        if (event.key === "Escape") event.target.blur();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k" || key === "arrowdown" || key === "arrowup") {
        event.preventDefault();
        const index = ordered.findIndex(({ key: ruleKey }) => ruleKey === selected?.key);
        const next = ordered[index + (key === "j" || key === "arrowdown" ? 1 : -1)];
        if (next) setSelectedKey(next.key);
      } else if (key === "/") {
        event.preventDefault();
        document.getElementById("rule-search")?.focus();
      } else if (key === "n") {
        event.preventDefault();
        document.getElementById("rationale")?.focus();
      } else if (ACTION_BY_KEY[key]) {
        event.preventDefault();
        void decide(ACTION_BY_KEY[key]);
      } else if (/^[1-9]$/.test(key)) {
        const profile = state.profiles[Number(key) - 1];
        if (profile) {
          event.preventDefault();
          void toggleProfile(profile.name);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    document
      .querySelector(`[data-rule-key="${CSS.escape(selected?.key ?? "")}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected?.key]);

  return (
    <section className="workspace">
      <aside className="rail">
        <nav className="status-list" aria-label="Review status">
          {STATUS_FILTERS.map(({ id, label }) => (
            <button
              className={status === id ? "status-button active" : "status-button"}
              key={id}
              onClick={() => setStatus(id)}
            >
              <span>{label}</span>
              <b>{statusCount(state, id)}</b>
            </button>
          ))}
        </nav>

        <div className="rail-label">Group by</div>
        <div className="segmented" role="radiogroup" aria-label="Group by">
          {GROUPINGS.map(({ id, label }) => (
            <button
              aria-checked={grouping === id}
              className={grouping === id ? "active" : ""}
              key={id}
              role="radio"
              onClick={() => {
                setGrouping(id);
                setFacet(undefined);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="facet-list">
          <button
            className={facet === undefined ? "facet-button active" : "facet-button"}
            onClick={() => setFacet(undefined)}
          >
            <span>Everything</span>
            <b>{inStatus.length}</b>
          </button>
          {facetCounts(inStatus, grouping).map(([value, count]) => (
            <button
              className={facet === value ? "facet-button active" : "facet-button"}
              key={value}
              onClick={() => setFacet(facet === value ? undefined : value)}
            >
              <span>{value}</span>
              <b>{count}</b>
            </button>
          ))}
        </div>

        <div className="shortcut-card">
          <span>
            <kbd>J</kbd>
            <kbd>K</kbd> move · <kbd>/</kbd> search · <kbd>N</kbd> note
          </span>
          <span>
            <kbd>E</kbd> keep · <kbd>R</kbd> reject · <kbd>D</kbd> defer · <kbd>U</kbd> reopen
          </span>
          <span>
            <kbd>1</kbd>–<kbd>{Math.max(state.profiles.length, 1)}</kbd> toggle profile
          </span>
        </div>
      </aside>

      <section className="list-column">
        <div className="list-toolbar">
          <input
            id="rule-search"
            aria-label="Search rules"
            placeholder="Search name, intent, source"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span>{ordered.length} shown</span>
        </div>
        <div className="rule-list">
          {ordered.length === 0 ? (
            <div className="empty-state">
              {status === "unreviewed" ? "Inbox zero." : "Nothing matches."}
            </div>
          ) : (
            groups.map(([group, rules]) => (
              <section key={group}>
                <header className="group-header">
                  <span>{group}</span>
                  <b>{rules.length}</b>
                </header>
                {rules.map((rule) => (
                  <RuleRow
                    isSelected={rule.key === selected?.key}
                    key={rule.key}
                    onSelect={() => setSelectedKey(rule.key)}
                    rule={rule}
                    state={state}
                  />
                ))}
              </section>
            ))
          )}
        </div>
      </section>

      {selected ? (
        <Inspector
          busy={busy}
          decide={decide}
          rationale={rationale}
          rule={selected}
          setRationale={setRationale}
          state={state}
          toggleProfile={toggleProfile}
        />
      ) : (
        <aside className="inspector">
          <div className="empty-state">Select a rule.</div>
        </aside>
      )}
    </section>
  );
}

function RuleRow({
  rule,
  state,
  isSelected,
  onSelect,
}: {
  rule: ReviewRule;
  state: ReviewState;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={isSelected ? "rule-row selected" : "rule-row"}
      data-rule-key={rule.key}
      onClick={onSelect}
    >
      <div className="row-top">
        <strong>{rule.name}</strong>
        <span className={`status-tag ${rule.review.status}`}>
          {rule.review.stale ? "changed · " : ""}
          {rule.review.status === "unreviewed" ? "" : rule.review.status}
        </span>
      </div>
      <p>{rule.description}</p>
      <div className="row-meta">
        <span className={`delivery ${rule.delivery.kind}`}>
          {DELIVERY_LABELS[rule.delivery.kind]}
        </span>
        {rule.ecosystem !== "any_typescript" && rule.ecosystem !== "unsorted" ? (
          <span>{ECOSYSTEM_LABELS[rule.ecosystem]}</span>
        ) : null}
        <span>{rule.sources.map(shortRepository).join(" + ")}</span>
        {rule.profiles.map((name) => (
          <span className="profile-chip" key={name}>
            {name}
            {state.profiles.find((profile) => profile.name === name)?.own[rule.key] ? "" : "*"}
          </span>
        ))}
      </div>
    </button>
  );
}

function Inspector({
  rule,
  state,
  busy,
  rationale,
  setRationale,
  decide,
  toggleProfile,
}: {
  rule: ReviewRule;
  state: ReviewState;
  busy: boolean;
  rationale: string;
  setRationale: (value: string) => void;
  decide: (action: ReviewAction) => Promise<void>;
  toggleProfile: (profile: string) => Promise<void>;
}) {
  const [files, setFiles] = useState<EvidenceFile[]>();
  const [examples, setExamples] = useState<ExampleSet[]>();
  const [tab, setTab] = useState(0);

  useEffect(() => {
    setFiles(undefined);
    setExamples(undefined);
    setTab(0);
    const controller = new AbortController();
    void fetch(`/api/evidence?key=${encodeURIComponent(rule.key)}`, { signal: controller.signal })
      .then(
        (response) => response.json() as Promise<{ files: EvidenceFile[]; examples: ExampleSet[] }>,
      )
      .then((evidence) => {
        setFiles(evidence.files);
        setExamples(evidence.examples);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [rule.key]);

  const file = files?.[tab];
  const decided = ["kept", "deferred", "rejected"].includes(rule.review.status);

  return (
    <aside className="inspector">
      <div className="inspector-scroll">
        <div className="kicker">
          {rule.taxonomy.domain} / {rule.taxonomy.category}
        </div>
        <h2>{rule.name}</h2>
        <p className="lede">{rule.description}</p>

        <div className="stamps">
          <span className={`stamp delivery ${rule.delivery.kind}`}>
            {DELIVERY_LABELS[rule.delivery.kind]}
            {rule.delivery.kind === "native" ? ` · ${rule.delivery.ruleId}` : ""}
          </span>
          {rule.delivery.kind === "native" ? (
            <span className="stamp">{fixLabel(rule.delivery.fix)}</span>
          ) : null}
          <span className="stamp">{ECOSYSTEM_LABELS[rule.ecosystem]}</span>
          {rule.delivery.kind === "native" ? null : (
            <span className={rule.testCoverage === "none" ? "stamp warn" : "stamp"}>
              {rule.testCoverage === "dedicated"
                ? "Dedicated tests"
                : rule.testCoverage === "linked"
                  ? "Shared test suite"
                  : "No tests"}
            </span>
          )}
          {(rule.projectSpecific ?? 0) > 0.5 ? (
            <span className="stamp warn">Likely repo-specific</span>
          ) : null}
          {rule.review.stale ? <span className="stamp warn">Changed since decision</span> : null}
          {!rule.classified ? <span className="stamp">Not classified</span> : null}
        </div>
        {rule.delivery.kind === "unsupported" ? (
          <p className="note">{rule.delivery.reason}</p>
        ) : null}
        {rule.delivery.kind === "native" ? (
          <p className="note">
            Built into Oxlint.{" "}
            <a href={rule.delivery.docsUrl} rel="noreferrer" target="_blank">
              Rule docs
            </a>
          </p>
        ) : null}

        <ExamplesPanel examples={examples} key={rule.key} rule={rule} />

        <section className="panel">
          <div className="section-title">
            <h3>Profiles</h3>
            <span>press 1–{state.profiles.length}</span>
          </div>
          <div className="profile-toggles">
            {state.profiles.map((profile, index) => {
              const own = rule.key in profile.own;
              const inherited = !own && rule.key in profile.resolved;
              return (
                <button
                  aria-pressed={own}
                  className={own ? "toggle on" : inherited ? "toggle inherited" : "toggle"}
                  disabled={busy || inherited}
                  key={profile.name}
                  onClick={() => void toggleProfile(profile.name)}
                  title={inherited ? `Included through ${profile.extends.join(", ")}` : undefined}
                >
                  <kbd>{index + 1}</kbd>
                  {profile.name}
                  {inherited ? <em>inherited</em> : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="section-title">
            <h3>Seen in</h3>
            <span>{rule.sightings.length} sightings</span>
          </div>
          <table className="sightings">
            <tbody>
              {rule.sightings.map((sighting) => (
                <tr key={sighting.id}>
                  <td>{sighting.source.repository}</td>
                  <td>{KIND_LABELS[sighting.artifact.kind]}</td>
                  <td>
                    <a
                      href={`https://github.com/${sighting.source.repository}/blob/${sighting.source.commit}/${sighting.artifact.implementationPaths[0] ?? ""}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {sighting.source.commit.slice(0, 7)}
                    </a>
                  </td>
                  <td>{sighting.artifact.testPaths.length} tests</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="section-title">
            <h3>Source</h3>
            <span>read-only</span>
          </div>
          {files === undefined ? (
            <div className="code-placeholder">Loading source…</div>
          ) : files.length === 0 ? (
            <div className="code-placeholder">No files recorded.</div>
          ) : (
            <>
              <div className="file-tabs">
                {files.map((entry, index) => (
                  <button
                    className={tab === index ? "file-tab active" : "file-tab"}
                    key={`${entry.repository}:${entry.path}`}
                    onClick={() => setTab(index)}
                    title={`${entry.repository}/${entry.path}`}
                  >
                    {rule.sources.length > 1 ? `${shortRepository(entry.repository)} · ` : ""}
                    {entry.path.split("/").at(-1)}
                  </button>
                ))}
              </div>
              {file?.available ? (
                <CodeBlock code={file.content} lang={languageForPath(file.path)} />
              ) : (
                <div className="code-placeholder">Run discovery to restore this checkout.</div>
              )}
            </>
          )}
        </section>
      </div>

      <div className="decision-dock">
        {rule.review.status === "shipped" ? (
          <p className="shipped-note">
            Ships from this repository. Change it under <code>ast-grep/</code> or{" "}
            <code>oxlint/</code>.
          </p>
        ) : (
          <>
            <label htmlFor="rationale">
              Note <span>optional · N to focus</span>
            </label>
            <textarea
              id="rationale"
              placeholder="Why keep, reject, or defer?"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />
            <div className="decision-actions">
              <button
                className="action reject"
                disabled={busy}
                onClick={() => void decide("reject")}
              >
                Reject <kbd>R</kbd>
              </button>
              <button className="action" disabled={busy} onClick={() => void decide("defer")}>
                Defer <kbd>D</kbd>
              </button>
              {decided ? (
                <button className="action" disabled={busy} onClick={() => void decide("reopen")}>
                  Reopen <kbd>U</kbd>
                </button>
              ) : null}
              <button className="action keep" disabled={busy} onClick={() => void decide("keep")}>
                Keep <kbd>E</kbd>
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function ExamplesPanel({
  examples,
  rule,
}: {
  examples: ExampleSet[] | undefined;
  rule: ReviewRule;
}) {
  const [expanded, setExpanded] = useState(false);
  const truncated = examples?.some(
    ({ breaks, passes }) => breaks.length > EXAMPLE_PREVIEW || passes.length > EXAMPLE_PREVIEW,
  );
  const fixes = examples?.flatMap(({ breaks }) => breaks).filter(({ fixed }) => fixed).length ?? 0;

  return (
    <section className="panel">
      <div className="section-title">
        <h3>Examples</h3>
        <span>{fixes > 0 ? `${fixes} with recorded fix` : "from upstream"}</span>
      </div>
      {examples === undefined ? (
        <div className="code-placeholder">Loading examples…</div>
      ) : examples.length === 0 ? (
        <p className="note">
          {rule.delivery.kind === "guidance"
            ? "Guidance is prose, so upstream has no examples. Write a breaking and a passing case if you keep it."
            : "Upstream docs and tests have no extractable examples. Write a breaking and a passing case if you keep it."}
        </p>
      ) : (
        examples.map((set) => (
          <div className="example-set" key={set.url}>
            <div className="example-source">
              <a href={set.url} rel="noreferrer" target="_blank">
                {set.label}
              </a>
              <span>{EXAMPLE_ORIGIN_LABELS[set.origin]}</span>
            </div>
            {(
              [
                ["breaks", "Breaks", set.breaks],
                ["passes", "Passes", set.passes],
              ] as const
            ).map(([tone, title, cases]) =>
              cases.length === 0 ? null : (
                <div className={`example-group ${tone}`} key={tone}>
                  <div className="example-label">
                    {title} <b>{cases.length}</b>
                  </div>
                  {(expanded ? cases : cases.slice(0, EXAMPLE_PREVIEW)).map((example, index) => (
                    <div className="example" key={index}>
                      <CodeBlock code={example.code} lang="tsx" lineNumbers={false} />
                      {example.fixed ? (
                        <>
                          <div className="example-label fixed">Fixes to</div>
                          <CodeBlock code={example.fixed} lang="tsx" lineNumbers={false} />
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              ),
            )}
          </div>
        ))
      )}
      {truncated ? (
        <button className="action small" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : "Show all cases"}
        </button>
      ) : null}
    </section>
  );
}
