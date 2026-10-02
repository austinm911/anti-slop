import type { SgNode } from "@ast-grep/napi";

/** Decodes a string or substitution-free template literal. Anything else returns `undefined`. */
export function literalString(node: SgNode | null | undefined): string | undefined {
  if (!node) return undefined;
  const kind = node.kind();
  if (kind === "template_string") {
    if (node.children().some((child) => child.kind() === "template_substitution")) {
      return undefined;
    }
    return unescapeLiteral(node.text().slice(1, -1));
  }
  if (kind === "string") return unescapeLiteral(node.text().slice(1, -1));
  return undefined;
}

const SIMPLE_ESCAPES = new Map([
  ["n", "\n"],
  ["t", "\t"],
  ["r", "\r"],
  ["b", "\b"],
  ["f", "\f"],
  ["v", "\v"],
  ["0", "\0"],
]);

function unescapeLiteral(body: string): string {
  return body.replace(
    /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r?\n|[\s\S])/g,
    (_, escape: string) => {
      if (escape.startsWith("u{"))
        return String.fromCodePoint(Number.parseInt(escape.slice(2, -1), 16));
      if (/^[ux][0-9a-fA-F]+$/.test(escape)) {
        return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
      }
      if (escape.endsWith("\n")) return "";
      return SIMPLE_ESCAPES.get(escape) ?? escape;
    },
  );
}
