#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { discoverCatalog, loadManifest } from "./discover.ts";
import { enrichCatalog } from "./enrich.ts";
import { renderCatalog } from "./report.ts";
import type { AgentKind, CandidateCatalog, SourceManifest } from "./types.ts";

const root = resolve(import.meta.dir, "../..");
const arguments_ = Bun.argv.slice(2);
const command = arguments_[0] ?? "discover";
const options = parseOptions(arguments_.slice(1));
const manifestPath = resolve(root, options.manifest ?? "discovery/sources.json");
const catalogPath = resolve(root, options.output ?? "discovery/candidates.json");
const reportPath = resolve(root, options.report ?? "docs/generated/candidate-catalog.md");
const cacheDirectory = resolve(root, options.cache ?? "discovery/cache");
const agent = parseAgent(options.agent ?? "none");

if (command === "discover") {
  const manifest = options.repo
    ? singleRepositoryManifest(options.repo, options.ref ?? "main")
    : await loadManifest(manifestPath);
  let catalog = await discoverCatalog(manifest, { cacheDirectory });
  if (agent !== "none") {
    catalog = await enrichCatalog(catalog, {
      agent,
      cacheDirectory,
      model: options.model,
      thinking: options.thinking ?? "xhigh",
      batchSize: parsePositiveInteger(options.batchSize, "batch-size") ?? 8,
    });
  }
  await writeOutputs(catalog, catalogPath, reportPath);
  printSummary(catalog, catalogPath, reportPath);
} else if (command === "triage") {
  if (agent === "none") throw new Error("triage requires --agent omp or --agent pi");
  const catalog = await readCatalog(catalogPath);
  const enriched = await enrichCatalog(catalog, {
    agent,
    cacheDirectory,
    model: options.model,
    thinking: options.thinking ?? "xhigh",
    batchSize: parsePositiveInteger(options.batchSize, "batch-size") ?? 8,
  });
  await writeOutputs(enriched, catalogPath, reportPath);
  printSummary(enriched, catalogPath, reportPath);
} else if (command === "report") {
  const catalog = await readCatalog(catalogPath);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, renderCatalog(catalog));
  await formatFiles([reportPath]);
  console.log(`Wrote ${reportPath}`);
} else {
  throw new Error(`Unknown discovery command: ${command}`);
}

async function writeOutputs(
  catalog: CandidateCatalog,
  outputPath: string,
  markdownPath: string,
): Promise<void> {
  await Promise.all([
    mkdir(dirname(outputPath), { recursive: true }),
    mkdir(dirname(markdownPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`),
    writeFile(markdownPath, renderCatalog(catalog)),
  ]);
  await formatFiles([outputPath, markdownPath]);
}

async function formatFiles(paths: string[]): Promise<void> {
  const process = Bun.spawn(["oxfmt", ...paths], { stdout: "pipe", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Failed to format generated catalog: ${stderr.trim()}`);
}

async function readCatalog(path: string): Promise<CandidateCatalog> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as CandidateCatalog;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.candidates)) {
    throw new Error(`Invalid candidate catalog: ${path}`);
  }
  return parsed;
}

function parseOptions(values: string[]): { [key: string]: string } {
  const parsed: { [key: string]: string } = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) throw new Error("Argument parsing reached an invalid index");
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const equalsIndex = value.indexOf("=");
    if (equalsIndex !== -1) {
      parsed[toCamelCase(value.slice(2, equalsIndex))] = value.slice(equalsIndex + 1);
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
    parsed[toCamelCase(value.slice(2))] = next;
    index += 1;
  }
  return parsed;
}

function parseAgent(value: string): AgentKind {
  if (value === "none" || value === "omp" || value === "pi") return value;
  throw new Error(`Invalid agent: ${value}`);
}

function singleRepositoryManifest(repo: string, ref: string): SourceManifest {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Invalid repository: ${repo}`);
  return { repositories: [{ repo, ref }] };
}

function parsePositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid --${name}: ${value}`);
  return parsed;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function printSummary(catalog: CandidateCatalog, outputPath: string, markdownPath: string): void {
  console.log(
    `Discovered ${catalog.candidates.length} candidates from ${catalog.sources.length} sources.\n` +
      `Catalog: ${outputPath}\nReport: ${markdownPath}`,
  );
}
