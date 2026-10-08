/**
 * Unit tests for validate-apps.js's own logic — checkReferences, checkReadme,
 * findDuplicates, and readmeAppsSection — independent of whatever apps.json
 * currently contains. `npm test` previously only ran validate-apps.js as a
 * smoke test against the live data file, so a bug in this parsing logic
 * would only surface if today's data happened to trip it.
 *
 * Uses node's built-in test runner (node:test), added in Node 18 and stable
 * in Node 20+ (this repo's minimum), so no new devDependency is needed.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parseArgs,
  loadJson,
  findDuplicates,
  checkReferences,
  checkReadme,
  readmeAppsSection,
} = require("./validate-apps");

test("findDuplicates", async (t) => {
  await t.test("returns no duplicates for unique values", () => {
    const { duplicates } = findDuplicates(["a", "b", "c"]);
    assert.deepEqual([...duplicates], []);
  });

  await t.test("collects values that appear more than once", () => {
    const { duplicates } = findDuplicates(["a", "b", "a", "c", "b", "b"]);
    assert.deepEqual([...duplicates].sort(), ["a", "b"]);
  });

  await t.test("seen contains every value regardless of duplication", () => {
    const { seen } = findDuplicates(["x", "y", "x"]);
    assert.deepEqual([...seen].sort(), ["x", "y"]);
  });
});

test("checkReferences", async (t) => {
  await t.test("passes on a well-formed document", () => {
    const doc = {
      categories: [{ id: "utility" }, { id: "games" }],
      apps: [
        { id: "app-1", name: "App One", category: ["utility"] },
        { id: "app-2", name: "App Two", category: ["games", "utility"] },
      ],
      featured: [{ id: "app-1" }],
    };
    assert.deepEqual(checkReferences(doc), []);
  });

  await t.test("flags a duplicate app id", () => {
    const doc = {
      categories: [],
      apps: [
        { id: "dup", name: "A" },
        { id: "dup", name: "B" },
      ],
    };
    const problems = checkReferences(doc);
    assert.ok(problems.some((p) => p.includes('duplicate app id "dup"')));
  });

  await t.test("flags a duplicate app name", () => {
    const doc = {
      categories: [],
      apps: [
        { id: "a", name: "Same Name" },
        { id: "b", name: "Same Name" },
      ],
    };
    const problems = checkReferences(doc);
    assert.ok(problems.some((p) => p.includes('duplicate app name "Same Name"')));
  });

  await t.test("flags a duplicate category id", () => {
    const doc = {
      categories: [{ id: "utility" }, { id: "utility" }],
      apps: [],
    };
    const problems = checkReferences(doc);
    assert.ok(problems.some((p) => p.includes('duplicate category id "utility"')));
  });

  await t.test("flags a featured entry with no matching app id", () => {
    const doc = {
      categories: [],
      apps: [{ id: "real-app", name: "Real" }],
      featured: [{ id: "ghost-app" }],
    };
    const problems = checkReferences(doc);
    assert.ok(
      problems.some((p) => p.includes('/featured/0/id "ghost-app" does not match any app id'))
    );
  });

  await t.test("flags a duplicate featured id", () => {
    const doc = {
      categories: [],
      apps: [{ id: "app-1", name: "A" }],
      featured: [{ id: "app-1" }, { id: "app-1" }],
    };
    const problems = checkReferences(doc);
    assert.ok(problems.some((p) => p.includes('duplicate featured id "app-1"')));
  });

  await t.test("flags an app category not declared in categories", () => {
    const doc = {
      categories: [{ id: "utility" }],
      apps: [{ id: "app-1", name: "A", category: ["not-declared"] }],
    };
    const problems = checkReferences(doc);
    assert.ok(
      problems.some((p) =>
        p.includes('/apps/0/category/0 "not-declared" is not a declared category id')
      )
    );
  });

  await t.test("tolerates missing apps/categories/featured arrays", () => {
    assert.deepEqual(checkReferences({}), []);
  });
});

test("readmeAppsSection", async (t) => {
  await t.test("extracts the body between ## Apps and the next ## heading", () => {
    const text = [
      "# Title",
      "",
      "## Apps",
      "",
      "| [Foo](https://foo.dev) | iOS | A foo app |",
      "",
      "## Other Section",
      "",
      "not part of Apps",
    ].join("\n");
    const section = readmeAppsSection(text);
    assert.ok(section.includes("[Foo](https://foo.dev)"));
    assert.ok(!section.includes("not part of Apps"));
  });

  await t.test("returns everything after the heading when it is the last section", () => {
    const text = ["# Title", "", "## Apps", "", "| [Foo](url) | iOS | desc |"].join("\n");
    const section = readmeAppsSection(text);
    assert.ok(section.includes("[Foo](url)"));
  });

  await t.test("returns null when there is no ## Apps heading", () => {
    const text = "# Title\n\n## Something Else\n\ncontent";
    assert.equal(readmeAppsSection(text), null);
  });
});

test("checkReadme", async (t) => {
  const tmpReadme = (text) => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const file = path.join(os.tmpdir(), `validate-apps-test-readme-${Date.now()}-${Math.random()}.md`);
    fs.writeFileSync(file, text, "utf8");
    return file;
  };

  await t.test("passes when the README table matches apps.json exactly", () => {
    const readme = tmpReadme(
      [
        "## Apps",
        "",
        "| App | Platform | Description |",
        "| --- | --- | --- |",
        "| [Foo](https://foo.dev) | iOS | A foo app |",
      ].join("\n")
    );
    const doc = { apps: [{ name: "Foo", platform: "iOS", homepage: "https://foo.dev" }] };
    assert.deepEqual(checkReadme(doc, readme), []);
  });

  await t.test("flags a platform mismatch between README and apps.json", () => {
    const readme = tmpReadme(
      [
        "## Apps",
        "",
        "| App | Platform | Description |",
        "| --- | --- | --- |",
        "| [Foo](https://foo.dev) | Android | A foo app |",
      ].join("\n")
    );
    const doc = { apps: [{ name: "Foo", platform: "iOS", homepage: "https://foo.dev" }] };
    const problems = checkReadme(doc, readme);
    assert.ok(problems.some((p) => p.includes('platform for "Foo" is "Android"')));
  });

  await t.test("flags a link mismatch between README and apps.json", () => {
    const readme = tmpReadme(
      [
        "## Apps",
        "",
        "| App | Platform | Description |",
        "| --- | --- | --- |",
        "| [Foo](https://wrong.example) | iOS | A foo app |",
      ].join("\n")
    );
    const doc = { apps: [{ name: "Foo", platform: "iOS", homepage: "https://foo.dev" }] };
    const problems = checkReadme(doc, readme);
    assert.ok(problems.some((p) => p.includes('link for "Foo" is "https://wrong.example"')));
  });

  await t.test("flags an app in apps.json missing from the README table", () => {
    const readme = tmpReadme(
      [
        "## Apps",
        "",
        "| App | Platform | Description |",
        "| --- | --- | --- |",
        "| [Foo](https://foo.dev) | iOS | A foo app |",
      ].join("\n")
    );
    const doc = {
      apps: [
        { name: "Foo", platform: "iOS", homepage: "https://foo.dev" },
        { name: "Missing App", platform: "iOS", homepage: "https://x.dev" },
      ],
    };
    const problems = checkReadme(doc, readme);
    assert.ok(problems.some((p) => p.includes('missing "Missing App"')));
  });

  await t.test("flags a README row naming an app not in apps.json", () => {
    const readme = tmpReadme(
      [
        "## Apps",
        "",
        "| App | Platform | Description |",
        "| --- | --- | --- |",
        "| [Ghost](https://ghost.dev) | iOS | not real |",
      ].join("\n")
    );
    const doc = { apps: [] };
    const problems = checkReadme(doc, readme);
    assert.ok(problems.some((p) => p.includes('lists "Ghost", which is not in apps.json')));
  });

  await t.test("flags a missing README when apps.json has apps", () => {
    const doc = { apps: [{ name: "Foo", platform: "iOS" }] };
    const problems = checkReadme(doc, "/nonexistent/path/README.md");
    assert.ok(problems.some((p) => p.includes("README not found")));
  });

  await t.test("does not flag a missing README when apps.json has no apps", () => {
    const problems = checkReadme({ apps: [] }, "/nonexistent/path/README.md");
    assert.deepEqual(problems, []);
  });

  await t.test("flags a README with no ## Apps section", () => {
    const readme = tmpReadme("# Title\n\nno apps section here");
    const problems = checkReadme({ apps: [] }, readme);
    assert.ok(problems.some((p) => p.includes("no `## Apps` section")));
  });

  await t.test(
    "flags a reformatted table that stops parsing instead of silently disabling the check",
    () => {
      // A table present but not matching the `| [Name](url) | Platform | Description |`
      // shape (e.g. plain text instead of a markdown link) must not be treated as
      // zero rows meaning "no apps to check" — this is the exact silent
      // self-disabling failure documented in validate-apps.js.
      const readme = tmpReadme(
        [
          "## Apps",
          "",
          "| App | Platform | Description |",
          "| --- | --- | --- |",
          "| Foo (no link) | iOS | A foo app |",
        ].join("\n")
      );
      const doc = { apps: [{ name: "Foo", platform: "iOS" }] };
      const problems = checkReadme(doc, readme);
      assert.ok(problems.some((p) => p.includes("the drift check is not running")));
    }
  );
});

// parseArgs and loadJson call process.exit on bad input; stub it (and
// console.error) so the failure path is observable instead of fatal.
function captureExit(fn) {
  const origExit = process.exit;
  const origErr = console.error;
  const errors = [];
  let exitCode = null;
  process.exit = (code) => {
    exitCode = code;
    throw new Error("process.exit called");
  };
  console.error = (msg) => errors.push(String(msg));
  try {
    fn();
  } catch (err) {
    if (err.message !== "process.exit called") throw err;
  } finally {
    process.exit = origExit;
    console.error = origErr;
  }
  return { exitCode, errors };
}

test("parseArgs", async (t) => {
  await t.test("returns nulls for no arguments", () => {
    assert.deepEqual(parseArgs([]), { dataArg: null, readmeArg: null, schemaArg: null });
  });

  await t.test("parses data path, --readme and --schema", () => {
    assert.deepEqual(
      parseArgs(["a.json", "--readme", "R.md", "--schema", "s.json"]),
      { dataArg: "a.json", readmeArg: "R.md", schemaArg: "s.json" }
    );
  });

  await t.test("accepts flags before the data path", () => {
    assert.deepEqual(parseArgs(["--readme", "R.md", "a.json"]), {
      dataArg: "a.json",
      readmeArg: "R.md",
      schemaArg: null,
    });
  });

  await t.test("exits when --readme has no value", () => {
    const { exitCode, errors } = captureExit(() => parseArgs(["--readme"]));
    assert.equal(exitCode, 1);
    assert.ok(errors[0].includes("--readme requires a path"));
  });

  await t.test("exits when --schema has no value", () => {
    const { exitCode, errors } = captureExit(() => parseArgs(["a.json", "--schema"]));
    assert.equal(exitCode, 1);
    assert.ok(errors[0].includes("--schema requires a path"));
  });

  await t.test("exits on an unknown option", () => {
    const { exitCode, errors } = captureExit(() => parseArgs(["--bogus"]));
    assert.equal(exitCode, 1);
    assert.ok(errors[0].includes("Unknown option: --bogus"));
  });

  await t.test("exits on a second positional argument", () => {
    const { exitCode, errors } = captureExit(() => parseArgs(["a.json", "b.json"]));
    assert.equal(exitCode, 1);
    assert.ok(errors[0].includes("Unexpected extra argument: b.json"));
  });
});

test("loadJson", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wvw-loadjson-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await t.test("parses a valid JSON file", () => {
    const file = path.join(dir, "ok.json");
    fs.writeFileSync(file, JSON.stringify({ apps: [] }));
    assert.deepEqual(loadJson(file, "apps"), { apps: [] });
  });

  await t.test("exits when the file is missing", () => {
    const { exitCode, errors } = captureExit(() => loadJson(path.join(dir, "nope.json"), "apps"));
    assert.equal(exitCode, 1);
    assert.ok(errors[0].includes("apps not found"));
  });

  await t.test("exits when the file is not valid JSON", () => {
    const file = path.join(dir, "bad.json");
    fs.writeFileSync(file, "{not json");
    const { exitCode, errors } = captureExit(() => loadJson(file, "apps"));
    assert.equal(exitCode, 1);
    assert.ok(errors[0].includes("Failed to parse apps as JSON"));
  });
});
