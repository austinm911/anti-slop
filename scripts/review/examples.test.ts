import { describe, expect, test } from "bun:test";
import { extractTestExamples, parseDocsExamples } from "./examples.ts";

describe("docs examples", () => {
  test("pairs each incorrect and correct heading with the code block after it", () => {
    const html = `
      <p>Examples of <strong>incorrect</strong> code for this rule:</p>
      <div><pre class="shiki"><code><span class="line"><span>try {} </span><span>catch</span><span> (bad) {}</span></span>
<span class="line"><span>a &amp;&amp; b &lt; c</span></span></code></pre></div>
      <p>Examples of <strong>correct</strong> code for this rule:</p>
      <div><pre class="shiki"><code><span class="line">try {} catch (error) {}</span></code></pre></div>`;
    expect(parseDocsExamples(html)).toEqual({
      breaks: [{ code: "try {} catch (bad) {}\na && b < c" }],
      passes: [{ code: "try {} catch (error) {}" }],
    });
  });
});

describe("RuleTester suites", () => {
  test("picks the run named after the rule from a shared suite and keeps autofix output", () => {
    const content = `
      tester.run("no-other", other, { valid: ["other();"], invalid: [] });
      tester.run("anti-slop/no-module-mocking", rule, {
        valid: ["const store = new Store();", { code: \`
          vi.spyOn(store, "save");
        \` }],
        invalid: [
          { code: "vi.mock('./store');", errors: [error] },
          { code: "const a = 1;\\nconst b = 2;", output: "const a = 1;\\n\\nconst b = 2;", errors: [error] },
          { code: \`\${dynamic}\`, errors: [error] },
        ],
      });`;
    expect(extractTestExamples("no-module-mocking", "rules.test.ts", content)).toEqual({
      origin: "rule-tester",
      passes: [{ code: "const store = new Store();" }, { code: 'vi.spyOn(store, "save");' }],
      breaks: [
        { code: "vi.mock('./store');" },
        { code: "const a = 1;\nconst b = 2;", fixed: "const a = 1;\n\nconst b = 2;" },
      ],
    });
  });
});

describe("ast-grep tests", () => {
  test("reads the rule's documents, including its tsx variant", () => {
    const content = `id: no-alias\nvalid:\n  - return value\ninvalid:\n  - |\n    const a = b\n    return a\n---\nid: no-alias-tsx\ninvalid:\n  - const c = <A />\n---\nid: unrelated\ninvalid:\n  - other\n`;
    expect(extractTestExamples("no-alias", "no-alias-test.yml", content)).toEqual({
      origin: "ast-grep-test",
      breaks: [{ code: "const a = b\nreturn a" }, { code: "const c = <A />" }],
      passes: [{ code: "return value" }],
    });
  });

  test("uses every document of a linked supplement that names another rule", () => {
    const content = "id: no-commented-alias\ninvalid:\n  - // Record<string, unknown>\n";
    expect(extractTestExamples("no-alias", "supplement-test.yml", content)?.breaks).toEqual([
      { code: "// Record<string, unknown>" },
    ]);
  });
});

describe("fixture suites", () => {
  test("sorts lint calls by the assertions that name the rule", () => {
    const content = `
      describe("policy rules", () => {
        test("blocks throw", async () => {
          const result = await lint("throw error;", { rules: ["no-throw", "no-try-catch"] });
          expect(result.exitCode).toBe(1);
        });
        test("allows panic", async () => {
          const valid = await lint("panic();");
          const invalid = await lint("throw new Error();");
          expect(valid.output).not.toContain("plugin(no-throw)");
          expect(invalid.output).toContain("plugin(no-throw)");
        });
        test("ignores a neighbouring rule", async () => {
          const result = await lint("throw literal;", { rules: ["no-throw-literal"] });
          expect(result.exitCode).toBe(1);
        });
      });
      describe("no-typeof", () => {
        const invalidCases = [["typeof value;", "typeof"]] as const;
        test("allows type queries", async () => {
          const result = await lint("type T = typeof value;");
          expect(result.exitCode).toBe(0);
        });
      });`;
    expect(extractTestExamples("no-throw", "rules.test.ts", content)).toEqual({
      origin: "bun-test",
      breaks: [{ code: "throw error;" }, { code: "throw new Error();" }],
      passes: [{ code: "panic();" }],
    });
    expect(extractTestExamples("no-typeof", "rules.test.ts", content)).toEqual({
      origin: "bun-test",
      breaks: [{ code: "typeof value;" }],
      passes: [{ code: "type T = typeof value;" }],
    });
  });
});
