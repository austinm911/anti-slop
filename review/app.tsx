import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import { Button } from "@astryxdesign/core/Button";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import type { ReviewAction, ReviewCandidate, ReviewState } from "../scripts/review/types.ts";
import "./review.css";

type Queue = "unreviewed" | "kept" | "decided" | "all";
type EvidenceFile = { path: string; content: string; available: boolean };

type EvidenceResponse = {
  candidateId: string;
  files: EvidenceFile[];
};

const QUEUES: Array<{ id: Queue; label: string }> = [
  { id: "unreviewed", label: "Inbox" },
  { id: "kept", label: "Kept" },
  { id: "decided", label: "Decided" },
  { id: "all", label: "All" },
];

function App() {
  const [state, setState] = useState<ReviewState>();
  const [selectedId, setSelectedId] = useState<string>();
  const [domain, setDomain] = useState<string>("All domains");
  const [category, setCategory] = useState<string>("All categories");
  const [queue, setQueue] = useState<Queue>("unreviewed");
  const [query, setQuery] = useState("");
  const [rationale, setRationale] = useState("");
  const [evidence, setEvidence] = useState<EvidenceResponse>();
  const [evidenceTab, setEvidenceTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void fetchState();
  }, []);

  const candidates = useMemo(() => {
    if (!state) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return state.candidates.filter((candidate) => {
      const queueMatches = queue === "all" || candidate.review.status === queue;
      const domainMatches = domain === "All domains" || candidate.taxonomy.domain === domain;
      const categoryMatches =
        category === "All categories" || candidate.taxonomy.category === category;
      const queryMatches =
        normalizedQuery.length === 0 ||
        `${candidate.name} ${candidate.description} ${candidate.source.repository}`
          .toLowerCase()
          .includes(normalizedQuery);
      return queueMatches && domainMatches && categoryMatches && queryMatches;
    });
  }, [category, domain, query, queue, state]);

  const selected =
    candidates.find(({ id }) => id === selectedId) ??
    state?.candidates.find(({ id }) => id === selectedId) ??
    candidates[0];

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setRationale(selected.review.rationale ?? "");
    setEvidence(undefined);
    setEvidenceTab(0);
    void fetch(`/api/evidence?id=${encodeURIComponent(selected.id)}`)
      .then((response) => response.json() as Promise<EvidenceResponse>)
      .then(setEvidence)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Evidence failed"),
      );
  }, [selected?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      if (!selected) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        event.preventDefault();
        const index = candidates.findIndex(({ id }) => id === selected.id);
        const offset = key === "j" ? 1 : -1;
        const next = candidates[index + offset];
        if (next) setSelectedId(next.id);
      }
      const actionByKey: Partial<Record<string, ReviewAction>> = {
        e: "keep",
        r: "reject",
        d: "defer",
      };
      const action = actionByKey[key];
      if (action) {
        event.preventDefault();
        void submitDecision(action);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [candidates, rationale, selected]);

  async function fetchState() {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("Could not load review state");
    const nextState = (await response.json()) as ReviewState;
    setState(nextState);
  }

  async function submitDecision(action: ReviewAction) {
    if (!selected || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId: selected.id, action, rationale }),
      });
      const body = (await response.json()) as ReviewState | { error: string };
      if (!response.ok || "error" in body) {
        throw new Error("error" in body ? body.error : "Review failed");
      }
      setState(body);
      const currentIndex = candidates.findIndex(({ id }) => id === selected.id);
      setSelectedId(candidates[currentIndex + 1]?.id ?? candidates[currentIndex - 1]?.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <div className="boot">Opening the rule room…</div>;

  return (
    <main className="app-frame">
      <header className="masthead">
        <div>
          <div className="kicker">anti-slop / local review</div>
          <h1>Rule room</h1>
        </div>
        <div className="progress-block">
          <span>{state.counts.total - state.counts.unreviewed} reviewed</span>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${((state.counts.total - state.counts.unreviewed) / state.counts.total) * 100}%`,
              }}
            />
          </div>
          <strong>{state.counts.unreviewed} remaining</strong>
        </div>
      </header>

      <section className="workspace">
        <aside className="domain-rail">
          <div className="queue-switcher">
            {QUEUES.map(({ id, label }) => (
              <button
                className={queue === id ? "queue-button active" : "queue-button"}
                key={id}
                onClick={() => setQueue(id)}
              >
                <span>{label}</span>
                <b>{queueCount(state, id)}</b>
              </button>
            ))}
          </div>
          <div className="rail-label">Semantic domains</div>
          <button
            className={domain === "All domains" ? "domain-button active" : "domain-button"}
            onClick={() => {
              setDomain("All domains");
              setCategory("All categories");
            }}
          >
            <span>All domains</span>
            <b>{state.counts.total}</b>
          </button>
          {state.domains.map((entry, index) => (
            <button
              className={domain === entry.domain ? "domain-button active" : "domain-button"}
              key={entry.domain}
              onClick={() => {
                setDomain(entry.domain);
                setCategory("All categories");
              }}
            >
              <i>{String(index + 1).padStart(2, "0")}</i>
              <span>{entry.domain}</span>
              <b>{entry.count}</b>
            </button>
          ))}
          {domain !== "All domains" ? (
            <div className="category-list">
              <button
                className={
                  category === "All categories" ? "category-button active" : "category-button"
                }
                onClick={() => setCategory("All categories")}
              >
                <span>All categories</span>
              </button>
              {state.domains
                .find((entry) => entry.domain === domain)
                ?.categories.filter(({ count }) => count > 0)
                .map((entry) => (
                  <button
                    className={
                      category === entry.category ? "category-button active" : "category-button"
                    }
                    key={entry.category}
                    onClick={() => setCategory(entry.category)}
                  >
                    <span>{entry.category}</span>
                    <b>{entry.count}</b>
                  </button>
                ))}
            </div>
          ) : null}
          <div className="shortcut-card">
            <strong>Keyboard</strong>
            <span>
              <kbd>J</kbd>
              <kbd>K</kbd> navigate
            </span>
            <span>
              <kbd>E</kbd> keep · <kbd>R</kbd> reject
            </span>
            <span>
              <kbd>D</kbd> defer
            </span>
          </div>
        </aside>

        <section className="candidate-column">
          <div className="list-toolbar">
            <input
              aria-label="Search candidates"
              placeholder="Search rules, source, intent…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span>{candidates.length} shown</span>
          </div>
          <div className="candidate-list">
            {candidates.length === 0 ? (
              <div className="empty-state">Nothing in this queue.</div>
            ) : (
              candidates.map((candidate) => (
                <CandidateRow
                  candidate={candidate}
                  isSelected={candidate.id === selected?.id}
                  key={candidate.id}
                  onSelect={() => setSelectedId(candidate.id)}
                />
              ))
            )}
          </div>
        </section>

        <aside className="inspector">
          {selected ? (
            <>
              <div className="inspector-scroll">
                <div className="candidate-heading">
                  <div className="kicker">{selected.taxonomy.category}</div>
                  <h2>{selected.name}</h2>
                  <p>{selected.description}</p>
                </div>
                <div className="provenance">
                  <span>{selected.source.repository}</span>
                  <code>{selected.source.commit.slice(0, 10)}</code>
                  <span>{selected.artifact.kind}</span>
                </div>
                <div className="fact-grid">
                  <Fact label="Semantic home" value={selected.taxonomy.domain} />
                  <Fact
                    label="Test evidence"
                    value={coverageLabel(selected)}
                    tone={selected.evidence.testCoverage === "none" ? "warn" : "good"}
                  />
                  <Fact label="Review state" value={selected.review.status} />
                  <Fact
                    label="Admission gaps"
                    value={String(selected.evidence.failedConditionCount)}
                    tone={selected.evidence.failedConditionCount > 0 ? "warn" : "good"}
                  />
                </div>

                <section className="evidence-section">
                  <div className="section-title">
                    <h3>Source evidence</h3>
                    <span>read-only</span>
                  </div>
                  {evidence?.files.length ? (
                    <>
                      <div className="file-tabs">
                        {evidence.files.map((file, index) => (
                          <button
                            className={evidenceTab === index ? "file-tab active" : "file-tab"}
                            key={file.path}
                            onClick={() => setEvidenceTab(index)}
                          >
                            {file.path.split("/").at(-1)}
                          </button>
                        ))}
                      </div>
                      <pre className="source-view">
                        <code>
                          {evidence.files[evidenceTab]?.available
                            ? evidence.files[evidenceTab]?.content
                            : "Run discovery to restore this source checkout."}
                        </code>
                      </pre>
                    </>
                  ) : (
                    <div className="source-loading">Loading source…</div>
                  )}
                </section>
              </div>

              <div className="decision-dock">
                <label htmlFor="rationale">
                  Decision note <span>optional</span>
                </label>
                <textarea
                  id="rationale"
                  placeholder="Why keep, reject, or defer this?"
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                />
                {error ? <div className="error-message">{error}</div> : null}
                {selected.review.status === "kept" ? (
                  <div className="deep-actions">
                    <Button
                      label="Adopt"
                      variant="primary"
                      isLoading={busy}
                      clickAction={() => submitDecision("adopt")}
                    />
                    <Button
                      label="Adapt"
                      variant="secondary"
                      isLoading={busy}
                      clickAction={() => submitDecision("adapt")}
                    />
                    <Button
                      label="Use native"
                      variant="ghost"
                      isLoading={busy}
                      clickAction={() => submitDecision("native")}
                    />
                    <Button
                      label="Reject"
                      variant="destructive"
                      isLoading={busy}
                      clickAction={() => submitDecision("reject")}
                    />
                  </div>
                ) : (
                  <div className="triage-actions">
                    <Button
                      label="Reject"
                      variant="destructive"
                      isLoading={busy}
                      clickAction={() => submitDecision("reject")}
                    />
                    <Button
                      label="Defer"
                      variant="secondary"
                      isLoading={busy}
                      clickAction={() => submitDecision("defer")}
                    />
                    <Button
                      label="Keep for evaluation"
                      variant="primary"
                      isLoading={busy}
                      clickAction={() => submitDecision("keep")}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">Select a candidate.</div>
          )}
        </aside>
      </section>
    </main>
  );
}

function CandidateRow({
  candidate,
  isSelected,
  onSelect,
}: {
  candidate: ReviewCandidate;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={isSelected ? "candidate-row selected" : "candidate-row"} onClick={onSelect}>
      <div className="row-top">
        <strong>{candidate.name}</strong>
        <span>{candidate.review.action ?? candidate.review.status}</span>
      </div>
      <p>{candidate.description}</p>
      <div className="row-meta">
        <span>{candidate.taxonomy.category}</span>
        <span>{candidate.source.repository}</span>
        <span className={candidate.evidence.testCoverage === "none" ? "missing" : ""}>
          {coverageLabel(candidate)}
        </span>
      </div>
    </button>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "warn" | "good" }) {
  return (
    <div className={`fact ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function coverageLabel(candidate: ReviewCandidate) {
  if (candidate.evidence.testCoverage === "dedicated") return "Dedicated test";
  if (candidate.evidence.testCoverage === "linked") return "Shared suite";
  return "No linked tests";
}

function queueCount(state: ReviewState, queue: Queue) {
  if (queue === "all") return state.counts.total;
  return state.counts[queue];
}

createRoot(document.getElementById("root")!).render(<App />);
