import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { ReviewState } from "../scripts/review/types.ts";
import { ProfilesView } from "./profiles-view.tsx";
import { RulesView, type Mutate } from "./rules-view.tsx";
import "./review.css";

type View = "rules" | "profiles";

function App() {
  const [state, setState] = useState<ReviewState>();
  const [view, setView] = useState<View>("rules");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void fetch("/api/state")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load review state");
        return response.json() as Promise<ReviewState>;
      })
      .then(setState)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const mutate: Mutate = async (path, body) => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as ReviewState | { error: string };
      if ("error" in result) throw new Error(result.error);
      setState(result);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return <div className="boot">{error ?? "Opening the rule room…"}</div>;
  }

  const reviewable = state.counts.total - state.counts.shipped;
  const reviewed = reviewable - state.counts.unreviewed;

  return (
    <main className="app-frame">
      <header className="masthead">
        <div className="title-block">
          <div className="kicker">anti-slop / local review</div>
          <h1>Rule room</h1>
        </div>
        <nav className="view-tabs" aria-label="View">
          {(["rules", "profiles"] as const).map((id) => (
            <button
              aria-current={view === id ? "page" : undefined}
              className={view === id ? "view-tab active" : "view-tab"}
              key={id}
              onClick={() => setView(id)}
            >
              {id === "rules" ? "Rules" : "Profiles"}
              <b>{id === "rules" ? state.counts.total : state.profiles.length}</b>
            </button>
          ))}
        </nav>
        <div className="progress-block">
          <span>
            {reviewed} of {reviewable} reviewed
          </span>
          <strong>{state.counts.unreviewed} in inbox</strong>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ transform: `scaleX(${reviewable === 0 ? 0 : reviewed / reviewable})` }}
            />
          </div>
        </div>
      </header>
      {error ? (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setError(undefined)}>Dismiss</button>
        </div>
      ) : null}
      {view === "rules" ? (
        <RulesView busy={busy} mutate={mutate} state={state} />
      ) : (
        <ProfilesView busy={busy} mutate={mutate} state={state} />
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<App />);
