import { createHighlighter } from "@tanstack/highlight/core";
import { js } from "@tanstack/highlight/languages/js";
import { json } from "@tanstack/highlight/languages/json";
import { markdown } from "@tanstack/highlight/languages/markdown";
import { shell } from "@tanstack/highlight/languages/shell";
import { ts } from "@tanstack/highlight/languages/ts";
import { tsx } from "@tanstack/highlight/languages/tsx";
import { yaml } from "@tanstack/highlight/languages/yaml";
import { createThemeCss, type HighlightTheme } from "@tanstack/highlight/theme";

const highlighter = createHighlighter({ languages: [js, json, markdown, shell, ts, tsx, yaml] });

/** Forest ink to match the review app's code panes: amber for syntax, sage for data. */
const forestInk: HighlightTheme = {
  name: "forest-ink",
  type: "dark",
  background: "#1e2723",
  foreground: "#dce6df",
  tokens: {
    token: "#dce6df",
    attr: "#9cc6d8",
    "code-inline": "#e8c48f",
    command: "#e8c48f",
    comment: "#7c8f84",
    deleted: "#e39a8f",
    function: "#f0cf94",
    heading: "#f0cf94",
    inserted: "#a9d3b5",
    keyword: "#e3a86b",
    link: "#9cc6d8",
    literal: "#9cc6d8",
    meta: "#7c8f84",
    number: "#9cc6d8",
    operator: "#b9c9bf",
    property: "#c9dfcf",
    selector: "#a9d3b5",
    string: "#a9d3b5",
    tag: "#e3a86b",
    type: "#e8c48f",
    variable: "#dce6df",
  },
};

const style = document.createElement("style");
style.textContent = createThemeCss({ dark: forestInk, darkSelector: ".code-pane" });
document.head.append(style);

const LANGUAGE_BY_EXTENSION: { [extension: string]: string } = {
  cjs: "js",
  js: "js",
  json: "json",
  jsonl: "json",
  md: "markdown",
  mjs: "js",
  sh: "shell",
  ts: "ts",
  tsx: "tsx",
  yml: "yaml",
  yaml: "yaml",
};

export function languageForPath(path: string): string {
  return LANGUAGE_BY_EXTENSION[path.split(".").at(-1) ?? ""] ?? "plaintext";
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  // The highlighter escapes source text, so its HTML is safe to insert.
  const { html } = highlighter.highlight(code, { lang, lineNumbers: true });
  return <div className="code-pane" dangerouslySetInnerHTML={{ __html: html }} />;
}
