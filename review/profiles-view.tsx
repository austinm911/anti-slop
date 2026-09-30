import { useMemo, useState } from "react";
import type {
  CompiledProfile,
  ReviewRule,
  ReviewState,
  Severity,
} from "../scripts/review/types.ts";
import { CodeBlock } from "./highlight.tsx";
import { DELIVERY_LABELS, ECOSYSTEM_LABELS, shortRepository } from "./labels.ts";
import type { Mutate } from "./rules-view.tsx";

const PREVIEWS = ["oxlint", "install", "ast-grep"] as const;
type Preview = (typeof PREVIEWS)[number];

const PREVIEW_LABELS: { [preview in Preview]: string } = {
  oxlint: ".oxlintrc.json",
  install: "Install",
  "ast-grep": "ast-grep",
};

export function ProfilesView({
  state,
  mutate,
  busy,
}: {
  state: ReviewState;
  mutate: Mutate;
  busy: boolean;
}) {
  const [selectedName, setSelectedName] = useState(state.profiles[0]?.name);
  const [preview, setPreview] = useState<Preview>("oxlint");
  const profile = state.profiles.find(({ name }) => name === selectedName) ?? state.profiles[0];
  const rulesByKey = useMemo(() => new Map(state.rules.map((rule) => [rule.key, rule])), [state]);

  return (
    <section className="workspace profiles">
      <aside className="rail">
        <div className="rail-label">Profiles</div>
        <div className="facet-list">
          {state.profiles.map((entry) => (
            <button
              className={entry.name === profile?.name ? "profile-button active" : "profile-button"}
              key={entry.name}
              onClick={() => setSelectedName(entry.name)}
            >
              <span>
                <strong>{entry.name}</strong>
                <small>
                  {entry.extends.length > 0 ? `extends ${entry.extends.join(", ")}` : "base"}
                </small>
              </span>
              <b>{Object.keys(entry.resolved).length}</b>
            </button>
          ))}
        </div>
        <NewProfileForm
          busy={busy}
          mutate={mutate}
          onCreated={setSelectedName}
          profiles={state.profiles}
        />
      </aside>

      {profile ? (
        <>
          <ProfileRules
            busy={busy}
            mutate={mutate}
            profile={profile}
            rulesByKey={rulesByKey}
            state={state}
          />
          <aside className="inspector preview">
            <div className="inspector-scroll">
              <div className="kicker">What a consumer installs</div>
              <h2>{profile.name}</h2>
              <p className="lede">
                Generated from <code>profiles/{profile.name}.json</code>. The registry build will
                publish this same output.
              </p>
              <div className="file-tabs">
                {PREVIEWS.map((id) => (
                  <button
                    className={preview === id ? "file-tab active" : "file-tab"}
                    key={id}
                    onClick={() => setPreview(id)}
                  >
                    {PREVIEW_LABELS[id]}
                  </button>
                ))}
              </div>
              {preview === "oxlint" ? (
                <CodeBlock code={profile.oxlintConfig} lang="json" />
              ) : preview === "install" ? (
                <>
                  <CodeBlock code={profile.install.commands} lang="shell" />
                  <p className="note">Then add the checks to package.json:</p>
                  <CodeBlock code={profile.install.scripts} lang="json" />
                </>
              ) : profile.astGrepRules.length > 0 ? (
                <CodeBlock
                  code={`# tools/ast-grep/sgconfig.yml loads these rule files\n${profile.astGrepRules.map((path) => `- ${path}`).join("\n")}\n`}
                  lang="yaml"
                />
              ) : (
                <div className="code-placeholder">This profile ships no ast-grep rules.</div>
              )}

              <section className="panel">
                <div className="section-title">
                  <h3>Before publishing</h3>
                  <span>{profile.gaps.length} gaps</span>
                </div>
                {profile.gaps.length === 0 ? (
                  <p className="note good">Every rule in this profile ships today.</p>
                ) : (
                  <ul className="gap-list">
                    {profile.gaps.map((gap) => (
                      <li key={gap.ruleKey}>
                        <strong>{rulesByKey.get(gap.ruleKey)?.name ?? gap.ruleKey}</strong>
                        <span>{gap.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </aside>
        </>
      ) : (
        <div className="empty-state">Create a profile to start.</div>
      )}
    </section>
  );
}

function ProfileRules({
  profile,
  state,
  rulesByKey,
  mutate,
  busy,
}: {
  profile: CompiledProfile;
  state: ReviewState;
  rulesByKey: Map<string, ReviewRule>;
  mutate: Mutate;
  busy: boolean;
}) {
  const gapKeys = new Set(profile.gaps.map(({ ruleKey }) => ruleKey));
  const entries = Object.entries(profile.resolved).map(([ruleKey, severity]) => ({
    ruleKey,
    severity,
    rule: rulesByKey.get(ruleKey),
    own: ruleKey in profile.own,
  }));
  const ready = entries.filter(({ ruleKey }) => !gapKeys.has(ruleKey));
  const blocked = entries.filter(({ ruleKey }) => gapKeys.has(ruleKey));
  // Kept rules are the shortlist. Surface the ones this profile does not include yet.
  const suggestions = state.rules.filter(
    (rule) => rule.review.status === "kept" && !(rule.key in profile.resolved),
  );
  // A profile named after an ecosystem (such as `effect`) also surfaces Jev's matching tags.
  const ecosystem = Object.entries(ECOSYSTEM_LABELS).find(([key]) => key === profile.name);
  const tagged = ecosystem
    ? state.rules.filter(
        (rule) =>
          rule.ecosystem === ecosystem[0] &&
          !(rule.key in profile.resolved) &&
          rule.review.status !== "kept" &&
          rule.review.status !== "rejected",
      )
    : [];

  const setSeverity = (ruleKey: string, severity: Severity | null) =>
    mutate("/api/profile-rule", { profile: profile.name, ruleKey, severity });

  return (
    <section className="list-column">
      <div className="profile-header">
        <div>
          <div className="kicker">Profile</div>
          <h2>{profile.name}</h2>
          <p>{profile.description}</p>
          {Object.keys(profile.categories).length > 0 ? (
            <p className="profile-categories">
              Plus every Oxlint{" "}
              {Object.entries(profile.categories)
                .map(([category, severity]) => `${category} rule at ${severity}`)
                .join(", ")}
              {profile.extends.length > 0 ? `, through ${profile.extends.join(", ")}` : ""}.
            </p>
          ) : null}
        </div>
        <div className="profile-stats">
          <span>
            <b>{ready.length}</b> ready
          </span>
          <span className={blocked.length > 0 ? "warn" : ""}>
            <b>{blocked.length}</b> blocked
          </span>
        </div>
      </div>
      <div className="rule-list">
        <ProfileSection
          busy={busy}
          entries={ready}
          empty="No rules ship yet."
          profile={profile}
          setSeverity={setSeverity}
          title="Ships today"
        />
        <ProfileSection
          busy={busy}
          entries={blocked}
          empty="Nothing blocked."
          profile={profile}
          setSeverity={setSeverity}
          title="Needs work before publishing"
        />
        <SuggestionSection
          busy={busy}
          empty="Keep rules in the Rules view to shortlist them here."
          rules={suggestions}
          setSeverity={setSeverity}
          title={`Kept, not in ${profile.name}`}
        />
        {ecosystem ? (
          <SuggestionSection
            busy={busy}
            empty="No other rules carry this tag."
            rules={tagged}
            setSeverity={setSeverity}
            title={`Tagged ${ecosystem[1]}, not decided yet`}
          />
        ) : null}
      </div>
    </section>
  );
}

function ProfileSection({
  title,
  empty,
  entries,
  profile,
  setSeverity,
  busy,
}: {
  title: string;
  empty: string;
  entries: Array<{ ruleKey: string; severity: Severity; rule?: ReviewRule; own: boolean }>;
  profile: CompiledProfile;
  setSeverity: (ruleKey: string, severity: Severity | null) => Promise<boolean>;
  busy: boolean;
}) {
  return (
    <section>
      <header className="group-header">
        <span>{title}</span>
        <b>{entries.length}</b>
      </header>
      {entries.length === 0 ? (
        <div className="section-empty">{empty}</div>
      ) : (
        entries.map(({ ruleKey, severity, rule, own }) => (
          <div className="profile-row" key={ruleKey}>
            {rule ? <RuleSummary rule={rule} /> : <strong>{ruleKey}</strong>}
            {own ? (
              <div className="row-controls">
                <div className="segmented compact" role="radiogroup" aria-label="Severity">
                  {(["error", "warn"] as const).map((level) => (
                    <button
                      aria-checked={severity === level}
                      className={severity === level ? "active" : ""}
                      disabled={busy}
                      key={level}
                      onClick={() => void setSeverity(ruleKey, level)}
                      role="radio"
                    >
                      {level}
                    </button>
                  ))}
                </div>
                <button
                  aria-label={`Remove ${rule?.name ?? ruleKey} from ${profile.name}`}
                  className="action small"
                  disabled={busy}
                  onClick={() => void setSeverity(ruleKey, null)}
                >
                  Remove
                </button>
              </div>
            ) : (
              <span className="inherited-tag">
                {severity} · from {profile.extends.join(", ")}
              </span>
            )}
          </div>
        ))
      )}
    </section>
  );
}

function SuggestionSection({
  title,
  empty,
  rules,
  setSeverity,
  busy,
}: {
  title: string;
  empty: string;
  rules: ReviewRule[];
  setSeverity: (ruleKey: string, severity: Severity | null) => Promise<boolean>;
  busy: boolean;
}) {
  return (
    <section>
      <header className="group-header">
        <span>{title}</span>
        <b>{rules.length}</b>
      </header>
      {rules.length === 0 ? (
        <div className="section-empty">{empty}</div>
      ) : (
        rules.map((rule) => (
          <div className="profile-row" key={rule.key}>
            <RuleSummary rule={rule} />
            <button
              className="action small"
              disabled={busy}
              onClick={() => void setSeverity(rule.key, "error")}
            >
              Add
            </button>
          </div>
        ))
      )}
    </section>
  );
}

function RuleSummary({ rule }: { rule: ReviewRule }) {
  return (
    <div className="rule-summary">
      <strong>{rule.name}</strong>
      <div className="row-meta">
        <span className={`delivery ${rule.delivery.kind}`}>
          {DELIVERY_LABELS[rule.delivery.kind]}
        </span>
        {rule.ecosystem !== "any_typescript" && rule.ecosystem !== "unsorted" ? (
          <span>{ECOSYSTEM_LABELS[rule.ecosystem]}</span>
        ) : null}
        <span>{rule.sources.map(shortRepository).join(" + ")}</span>
      </div>
    </div>
  );
}

function NewProfileForm({
  profiles,
  mutate,
  busy,
  onCreated,
}: {
  profiles: CompiledProfile[];
  mutate: Mutate;
  busy: boolean;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [base, setBase] = useState("recommended");
  const [description, setDescription] = useState("");

  return (
    <form
      className="new-profile"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        void mutate("/api/profiles", {
          name: trimmed,
          description,
          extends: base ? [base] : [],
        }).then((created) => {
          if (!created) return;
          onCreated(trimmed);
          setName("");
          setDescription("");
        });
      }}
    >
      <div className="rail-label">New profile</div>
      <input
        aria-label="Profile name"
        placeholder="name, e.g. react"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        aria-label="Base profile"
        value={base}
        onChange={(event) => setBase(event.target.value)}
      >
        <option value="">No base</option>
        {profiles.map(({ name: option }) => (
          <option key={option} value={option}>
            extends {option}
          </option>
        ))}
      </select>
      <input
        aria-label="Profile description"
        placeholder="What it's for"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <button className="action keep" disabled={busy || name.trim().length === 0} type="submit">
        Create profile
      </button>
    </form>
  );
}
