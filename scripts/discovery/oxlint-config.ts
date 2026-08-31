import { Lang, parse, type SgNode } from "@ast-grep/napi";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";

const SOURCE_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
const NESTED_CONFIG_PROPERTIES = new Set(["extends", "overrides"]);
const WRAPPER_KINDS = new Set([
  "as_expression",
  "non_null_expression",
  "parenthesized_expression",
  "satisfies_expression",
  "type_assertion",
]);

type ModuleContext = {
  availablePaths: Set<string>;
  root: string;
};

type ParsedModule = {
  content: string;
  root: SgNode;
};

type Binding =
  | { expression: SgNode; moduleSpecifier?: never; importedName?: never }
  | { expression?: never; moduleSpecifier: string; importedName: string };

export type OxlintPolicyEvidence = {
  content: string;
  paths: string[];
  ruleNames: string[];
};

export async function readOxlintPolicyEvidence(
  root: string,
  entryPath: string,
  availablePaths: Set<string>,
): Promise<OxlintPolicyEvidence> {
  const context: ModuleContext = { availablePaths, root };
  const modules = new Map<string, ParsedModule>();
  const visitedExports = new Set<string>();
  const ruleNames = new Set<string>();

  await collectExportedConfig(entryPath, "default", context, modules, visitedExports, ruleNames);

  const paths = [...modules.keys()];
  return {
    paths,
    content: paths.map((path) => `// ${path}\n${modules.get(path)?.content ?? ""}`).join("\n"),
    ruleNames: [...ruleNames].sort(),
  };
}

async function collectExportedConfig(
  path: string,
  exportName: string,
  context: ModuleContext,
  modules: Map<string, ParsedModule>,
  visitedExports: Set<string>,
  ruleNames: Set<string>,
): Promise<void> {
  const visitKey = `${path}:${exportName}`;
  if (visitedExports.has(visitKey)) return;
  visitedExports.add(visitKey);

  const module = await parseModule(path, context.root, modules);
  const exported = findExport(module.root, exportName);
  if (!exported) return;

  if (exported.moduleSpecifier) {
    const dependency = resolveSourcePath(path, exported.moduleSpecifier, context.availablePaths);
    if (dependency) {
      await collectExportedConfig(
        dependency,
        exported.importedName,
        context,
        modules,
        visitedExports,
        ruleNames,
      );
    }
    return;
  }

  if (exported.expression) {
    await collectExpression(exported.expression, path, context, modules, visitedExports, ruleNames);
  }
}

async function collectExpression(
  expression: SgNode,
  path: string,
  context: ModuleContext,
  modules: Map<string, ParsedModule>,
  visitedExports: Set<string>,
  ruleNames: Set<string>,
): Promise<void> {
  const unwrapped = unwrapExpression(expression);

  if (unwrapped.kind() === "object") {
    for (const property of namedChildren(unwrapped)) {
      if (property.kind() === "pair") {
        const name = propertyName(property.field("key"));
        const value = property.field("value");
        if (!value) continue;
        if (name === "rules") collectRuleKeys(value, ruleNames);
        else if (name && NESTED_CONFIG_PROPERTIES.has(name)) {
          await collectExpression(value, path, context, modules, visitedExports, ruleNames);
        }
      } else if (property.kind() === "spread_element") {
        const spread = namedChildren(property)[0];
        if (spread) {
          await collectExpression(spread, path, context, modules, visitedExports, ruleNames);
        }
      }
    }
    return;
  }

  if (unwrapped.kind() === "array") {
    for (const element of namedChildren(unwrapped)) {
      await collectExpression(element, path, context, modules, visitedExports, ruleNames);
    }
    return;
  }

  if (unwrapped.kind() === "call_expression" || unwrapped.kind() === "new_expression") {
    const argumentsNode = unwrapped.field("arguments");
    if (!argumentsNode) return;
    for (const argument of namedChildren(argumentsNode)) {
      await collectExpression(argument, path, context, modules, visitedExports, ruleNames);
    }
    return;
  }

  if (unwrapped.kind() !== "identifier") return;
  const module = modules.get(path);
  if (!module) return;
  const local = findLocalBinding(module.root, unwrapped.text());
  if (!local) return;

  if (local.expression) {
    await collectExpression(local.expression, path, context, modules, visitedExports, ruleNames);
    return;
  }

  const dependency = resolveSourcePath(path, local.moduleSpecifier, context.availablePaths);
  if (dependency) {
    await collectExportedConfig(
      dependency,
      local.importedName,
      context,
      modules,
      visitedExports,
      ruleNames,
    );
  }
}

function collectRuleKeys(expression: SgNode, ruleNames: Set<string>): void {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.kind() !== "object") return;
  for (const property of namedChildren(unwrapped)) {
    if (property.kind() !== "pair" && property.kind() !== "method_definition") continue;
    const name = propertyName(property.field("key") ?? namedChildren(property)[0]);
    if (name) ruleNames.add(name);
  }
}

function findExport(root: SgNode, exportName: string): Binding | undefined {
  const exports = root.findAll({ rule: { kind: "export_statement" } });
  for (const statement of exports) {
    if (exportName === "default") {
      const value = statement.field("value");
      if (value) return { expression: value };
    }

    const clause = namedChildren(statement).find((child) => child.kind() === "export_clause");
    if (!clause) continue;
    for (const specifier of namedChildren(clause)) {
      if (specifier.kind() !== "export_specifier") continue;
      const identifiers = namedChildren(specifier);
      const exported = identifiers.at(-1)?.text();
      if (exported !== exportName) continue;
      const importedName = identifiers[0]?.text() ?? exportName;
      const source = stringContent(statement.field("source"));
      if (source) return { moduleSpecifier: source, importedName };
      return findLocalBinding(root, importedName);
    }
  }
  return findLocalBinding(root, exportName);
}

function findLocalBinding(root: SgNode, name: string): Binding | undefined {
  const declarations = root.findAll({ rule: { kind: "variable_declarator" } });
  for (const declaration of declarations) {
    if (declaration.field("name")?.text() !== name) continue;
    const value = declaration.field("value");
    if (value) return { expression: value };
  }

  const imports = root.findAll({ rule: { kind: "import_statement" } });
  for (const statement of imports) {
    const source = stringContent(statement.field("source"));
    if (!source) continue;
    const clause = namedChildren(statement).find((child) => child.kind() === "import_clause");
    if (!clause) continue;
    const directIdentifier = namedChildren(clause).find((child) => child.kind() === "identifier");
    if (directIdentifier?.text() === name) {
      return { moduleSpecifier: source, importedName: "default" };
    }
    const namedImports = namedChildren(clause).find((child) => child.kind() === "named_imports");
    if (!namedImports) continue;
    for (const specifier of namedChildren(namedImports)) {
      if (specifier.kind() !== "import_specifier") continue;
      const identifiers = namedChildren(specifier);
      if (identifiers.at(-1)?.text() === name) {
        return { moduleSpecifier: source, importedName: identifiers[0]?.text() ?? name };
      }
    }
  }
  return undefined;
}

function unwrapExpression(expression: SgNode): SgNode {
  let current = expression;
  while (WRAPPER_KINDS.has(String(current.kind()))) {
    const child = namedChildren(current).at(-1);
    if (!child) break;
    current = child;
  }
  return current;
}

function propertyName(node: SgNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.kind() === "property_identifier" || node.kind() === "identifier") return node.text();
  if (node.kind() === "string") return stringContent(node);
  if (node.kind() === "number") return node.text();
  return undefined;
}

function stringContent(node: SgNode | null | undefined): string | undefined {
  if (!node || node.kind() !== "string") return undefined;
  return (
    namedChildren(node)
      .find((child) => child.kind() === "string_fragment")
      ?.text() ?? ""
  );
}

function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed());
}

async function parseModule(
  path: string,
  root: string,
  modules: Map<string, ParsedModule>,
): Promise<ParsedModule> {
  const cached = modules.get(path);
  if (cached) return cached;
  const content = await readFile(join(root, path), "utf8");
  const language = /\.[jt]sx$/i.test(path) ? Lang.Tsx : Lang.TypeScript;
  const parsed = { content, root: parse(language, content).root() };
  modules.set(path, parsed);
  return parsed;
}

function resolveSourcePath(
  importer: string,
  specifier: string,
  availablePaths: Set<string>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = normalize(join(dirname(importer), specifier));
  const candidates = extname(base)
    ? [base]
    : SOURCE_EXTENSIONS.flatMap((extension) => [
        `${base}${extension}`,
        join(base, `index${extension}`),
      ]);
  return candidates.find((candidate) => availablePaths.has(candidate));
}
