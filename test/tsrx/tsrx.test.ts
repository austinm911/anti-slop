import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const harness = import.meta.dir;
const repository = resolve(harness, "../..");
const oxlint = join(harness, "node_modules/.bin/oxlint");
const check = join(repository, "oxlint/check-tsrx-oxc.mjs");

type Finding = { code: string; line: number; column: number };

/** Lints with the harness's @tsrx/oxc and returns each diagnostic at its authored position. */
async function lint(config: string, file: string): Promise<Finding[]> {
  const process = Bun.spawn([oxlint, "--config", config, "--format=json", file], {
    cwd: harness,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(process.stdout).text();
  await process.exited;
  const report = JSON.parse(output) as {
    diagnostics: Array<{ code: string; labels: Array<{ span: { line: number; column: number } }> }>;
  };
  return report.diagnostics.map(({ code, labels }) => ({
    code,
    line: labels[0]?.span.line ?? 0,
    column: labels[0]?.span.column ?? 0,
  }));
}

describe("@tsrx/oxc", () => {
  test("runs native rules and JavaScript plugins on .tsrx at authored positions", async () => {
    const findings = await lint(
      join(harness, "fixtures/plugin.oxlintrc.json"),
      join(harness, "fixtures/feed.tsrx"),
    );
    expect(findings).toEqual([
      { code: "eslint(no-var)", line: 4, column: 3 },
      // The keyed `.map()` on line 6 passes.
      { code: "fixture(keyed-map)", line: 5, column: 36 },
      // `@if` reaches a rule as an IfStatement, reported at the authored block.
      { code: "fixture(control-flow)", line: 8, column: 4 },
    ]);
  });

  test("applies this repository's Oxlint configuration to .tsrx", async () => {
    const findings = await lint(
      join(repository, "oxlint/.oxlintrc.json"),
      join(harness, "fixtures/payload.tsrx"),
    );
    expect(findings).toEqual([{ code: "typescript(no-restricted-types)", line: 1, column: 23 }]);
  });
});

describe("check-tsrx-oxc", () => {
  test("passes on a real @tsrx/oxc install", async () => {
    expect(await runCheck(harness)).toMatchObject({ exitCode: 0 });
  });

  test.each([
    {
      name: "a direct oxlint dependency",
      manifest: { devDependencies: { "@tsrx/oxc": "0.18.0", oxlint: "1.77.0" } },
      expected: "Remove the direct `oxlint` dependency",
    },
    {
      name: "a direct oxfmt dependency",
      manifest: { devDependencies: { "@tsrx/oxc": "0.18.0", oxfmt: "0.61.0" } },
      expected: "Remove the direct `oxfmt` dependency",
    },
    {
      name: "a stale install",
      manifest: { devDependencies: { "@tsrx/oxc": "0.19.0" } },
      expected: "Installed @tsrx/oxc 0.18.0 does not match the pinned 0.19.0",
    },
    {
      name: "a range instead of a pin",
      manifest: { devDependencies: { "@tsrx/oxc": "^0.18.0" } },
      expected: "Pin `@tsrx/oxc` to an exact version",
    },
    {
      name: "a stale catalog install",
      manifest: {
        devDependencies: { "@tsrx/oxc": "catalog:" },
        workspaces: { catalog: { "@tsrx/oxc": "0.16.0" } },
      },
      expected: "does not match the pinned 0.16.0",
    },
    {
      name: "@oxlint/plugins on another Oxlint release",
      manifest: { devDependencies: { "@tsrx/oxc": "0.18.0", "@oxlint/plugins": "1.80.0" } },
      plugins: "1.80.0",
      expected: "Pin @oxlint/plugins to 1.83.0",
    },
  ])("fails on $name", async ({ manifest, plugins, expected }) => {
    const root = await fakeProject(manifest, plugins);
    try {
      const result = await runCheck(root);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("accepts a pinned catalog entry and a matching @oxlint/plugins", async () => {
    const root = await fakeProject(
      {
        devDependencies: { "@tsrx/oxc": "catalog:", "@oxlint/plugins": "catalog:" },
        workspaces: { catalog: { "@tsrx/oxc": "0.18.0", "@oxlint/plugins": "1.83.0" } },
      },
      "1.83.0",
    );
    try {
      expect(await runCheck(root)).toMatchObject({ exitCode: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function runCheck(root: string): Promise<{ exitCode: number; stderr: string }> {
  const process = Bun.spawn(["node", check, root], { stdout: "pipe", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stderr };
}

/** A project whose installed @tsrx/oxc 0.18.0 bundles oxlint 1.83.0. */
async function fakeProject(manifest: object, plugins?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anti-slop-tsrx-check-"));
  await writeFile(join(root, "package.json"), JSON.stringify(manifest));
  await mkdir(join(root, "node_modules/@tsrx/oxc"), { recursive: true });
  await writeFile(
    join(root, "node_modules/@tsrx/oxc/package.json"),
    JSON.stringify({ version: "0.18.0", dependencies: { "oxlint-current": "npm:oxlint@1.83.0" } }),
  );
  if (plugins) {
    await mkdir(join(root, "node_modules/@oxlint/plugins"), { recursive: true });
    await writeFile(
      join(root, "node_modules/@oxlint/plugins/package.json"),
      JSON.stringify({ version: plugins }),
    );
  }
  return root;
}
