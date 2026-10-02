/**
 * Builds what the npm package publishes: one Oxlint config per profile under `oxlint/configs/`
 * and a module per plugin under `dist/plugins/`. `--check` fails when a committed config
 * is stale. Both modes write `dist/plugins/`, which is gitignored, and lint a sample file with
 * every config, because Oxlint rejects a config whose plugin or rule does not load.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PLUGIN_SOURCES } from "./review/plugins.ts";
import { loadReviewState, reviewPaths } from "./review/project.ts";

const root = resolve(import.meta.dir, "..");
const check = process.argv.includes("--check");
const configsDirectory = join(root, "oxlint/configs");

const pluginsDirectory = join(root, "dist/plugins");
await mkdir(pluginsDirectory, { recursive: true });
await Promise.all(
  PLUGIN_SOURCES.map(async (source) => {
    if (!source.vendored) {
      await writeFile(
        join(pluginsDirectory, `${source.file}.js`),
        `export { default } from ${JSON.stringify(source.module)};\n`,
      );
      return;
    }
    const result = await Bun.build({
      entrypoints: [join(root, source.module)],
      outdir: pluginsDirectory,
      naming: `${source.file}.js`,
      target: "node",
      format: "esm",
    });
    if (!result.success) throw new AggregateError(result.logs, `Could not bundle ${source.file}`);
  }),
);

const paths = reviewPaths(root);
const { profiles } = await loadReviewState(paths);
const expected = new Map(profiles.map(({ name, oxlintConfig }) => [`${name}.json`, oxlintConfig]));
const existing = (await readdir(configsDirectory).catch(() => [])).filter((file) =>
  file.endsWith(".json"),
);

if (check) {
  const changed = await Promise.all(
    [...expected].map(([file, content]) =>
      readFile(join(configsDirectory, file), "utf8").then(
        (current) => (current === content ? undefined : file),
        () => file,
      ),
    ),
  );
  const files = [
    ...changed.filter((file) => file !== undefined),
    ...existing.filter((file) => !expected.has(file)),
  ];
  if (files.length > 0) {
    throw new Error(`Stale profile configs: ${files.join(", ")}. Run \`bun run build\`.`);
  }
} else {
  await mkdir(configsDirectory, { recursive: true });
  await Promise.all([
    ...existing
      .filter((name) => !expected.has(name))
      .map((file) => rm(join(configsDirectory, file))),
    ...[...expected].map(([file, content]) => writeFile(join(configsDirectory, file), content)),
  ]);
}

const scratch = await mkdtemp(join(tmpdir(), "anti-slop-build-"));
try {
  const sample = join(scratch, "sample.ts");
  await writeFile(sample, "export const value = 1;\n");
  const failures = await Promise.all(
    [...expected.keys()].map(async (file) => {
      const run = Bun.spawn(
        [paths.oxlintBinary, "--config", join(configsDirectory, file), sample],
        { cwd: scratch, stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(run.stdout).text(),
        new Response(run.stderr).text(),
        run.exited,
      ]);
      return exitCode === 0 ? undefined : `${file} does not load:\n${stdout}${stderr}`;
    }),
  );
  const errors = failures.filter((failure) => failure !== undefined);
  if (errors.length > 0) throw new Error(errors.join("\n"));
} finally {
  await rm(scratch, { recursive: true, force: true });
}

console.log(`${check ? "Checked" : "Built"} ${expected.size} profile configs.`);
