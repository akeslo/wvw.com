#!/usr/bin/env node
/**
 * Validates apps.json against apps.schema.json using ajv.
 *
 * Usage:
 *   node validate-apps.js                 # validates ./apps.json
 *   node validate-apps.js path/to/file.json  # validates an arbitrary file
 */

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const schemaPath = path.join(__dirname, "apps.schema.json");
const dataPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "apps.json");

function loadJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`✗ ${label} not found: ${filePath}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`✗ Failed to parse ${label} as JSON: ${filePath}`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }
}

const schema = loadJson(schemaPath, "schema");
const data = loadJson(dataPath, "data file");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

/**
 * Collects values that appear more than once, preserving first-seen order.
 */
function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return { seen, duplicates };
}

/**
 * Cross-reference checks the JSON Schema cannot express: app ids must be
 * unique (they are used in URLs and for deduplication), app names must be
 * unique (they are the join key the README table check below matches on — two
 * apps sharing a name make that check compare against the wrong record and
 * still pass), every featured entry must point at a real app and may only
 * appear once (a repeated id renders the same carousel banner twice), and
 * every app category must exist in `categories`.
 * Without these, a typo ships a broken storefront while CI stays green.
 */
function checkReferences(doc) {
  const problems = [];
  const apps = Array.isArray(doc.apps) ? doc.apps : [];
  const categories = Array.isArray(doc.categories) ? doc.categories : [];

  const appIds = apps.map((app) => app && app.id).filter((id) => typeof id === "string");
  const { seen, duplicates } = findDuplicates(appIds);
  for (const id of duplicates) {
    problems.push(`/apps duplicate app id "${id}"`);
  }

  const appNames = apps
    .map((app) => app && app.name)
    .filter((name) => typeof name === "string");
  for (const name of findDuplicates(appNames).duplicates) {
    problems.push(`/apps duplicate app name "${name}"`);
  }

  // Category ids are the join key app.category entries resolve against, so a
  // repeat renders a duplicate sidebar entry and makes the app-category check
  // below pass against whichever record happens to be indexed. Same uniqueness
  // invariant as app ids, app names, and featured ids above.
  const declaredCategoryIds = categories
    .map((cat) => cat && cat.id)
    .filter((id) => typeof id === "string");
  for (const id of findDuplicates(declaredCategoryIds).duplicates) {
    problems.push(`/categories duplicate category id "${id}"`);
  }

  const categoryIds = new Set(declaredCategoryIds);

  const featured = Array.isArray(doc.featured) ? doc.featured : [];
  featured.forEach((entry, index) => {
    if (entry && typeof entry.id === "string" && !seen.has(entry.id)) {
      problems.push(`/featured/${index}/id "${entry.id}" does not match any app id`);
    }
  });

  const featuredIds = featured
    .map((entry) => entry && entry.id)
    .filter((id) => typeof id === "string");
  for (const id of findDuplicates(featuredIds).duplicates) {
    problems.push(`/featured duplicate featured id "${id}"`);
  }

  apps.forEach((app, index) => {
    const cats = Array.isArray(app && app.category) ? app.category : [];
    cats.forEach((cat, catIndex) => {
      if (typeof cat === "string" && !categoryIds.has(cat)) {
        problems.push(
          `/apps/${index}/category/${catIndex} "${cat}" is not a declared category id`
        );
      }
    });
  });

  return problems;
}

/**
 * The README's "Apps" table is hand-maintained but describes the same apps as
 * apps.json, so it silently goes stale (a wrong platform label shipped once and
 * had to be corrected by hand). Every app must have a row, every row must name a
 * real app, and the platform label and link must match the data file. The row
 * description is deliberately not compared — it is prose, not a mirrored field.
 * Only runs when validating this repo's own apps.json.
 */
const README_ROW = /^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|([^|]*)\|([^|]*)\|\s*$/gm;
const README_APPS_HEADING = /^##\s+Apps\s*$/m;
const README_TABLE_LINE = /^\|.*\|\s*$/gm;
const README_SEPARATOR_ROW = /^\|[\s|:-]*\|\s*$/;

/**
 * Isolates the `## Apps` section so the row regex cannot reach tables elsewhere
 * in the README (any other table with a link in its first column would be read
 * as an app row and reported as an app missing from apps.json).
 */
function readmeAppsSection(text) {
  const heading = README_APPS_HEADING.exec(text);
  if (!heading) return null;
  const start = heading.index + heading[0].length;
  const next = /^##\s+/m.exec(text.slice(start));
  return next ? text.slice(start, start + next.index) : text.slice(start);
}

function checkReadme(doc) {
  const problems = [];
  const readmePath = path.join(__dirname, "README.md");
  if (!fs.existsSync(readmePath)) return problems;

  const section = readmeAppsSection(fs.readFileSync(readmePath, "utf8"));
  if (section === null) {
    problems.push("README has no `## Apps` section, so the app table cannot be checked against apps.json");
    return problems;
  }

  const rows = [...section.matchAll(README_ROW)].map(
    (m) => ({ name: m[1], url: m[2], platform: m[3].trim() })
  );

  // Bailing out silently on zero parsed rows would switch this whole check off
  // the moment someone reformats the table — the exact silent drift it exists to
  // catch. Count the raw table lines and complain when they stopped parsing.
  if (rows.length === 0) {
    const tableLines = [...section.matchAll(README_TABLE_LINE)].map((m) => m[0]);
    const dataLines = tableLines.filter((line) => !README_SEPARATOR_ROW.test(line));
    // First data line is the `| App | Platform | Description |` header.
    if (dataLines.length > 1) {
      problems.push(
        `README app table has ${dataLines.length - 1} row(s) but none match the expected ` +
          "`| [Name](url) | Platform | Description |` format — the drift check is not running"
      );
    } else if (Array.isArray(doc.apps) && doc.apps.length > 0) {
      problems.push("README `## Apps` section has no app table rows, but apps.json lists apps");
    }
    return problems;
  }

  const apps = Array.isArray(doc.apps) ? doc.apps : [];
  const byName = new Map(
    apps.filter((app) => app && typeof app.name === "string").map((app) => [app.name, app])
  );

  for (const row of rows) {
    const app = byName.get(row.name);
    if (!app) {
      problems.push(`README app table lists "${row.name}", which is not in apps.json`);
      continue;
    }
    if (app.platform !== row.platform) {
      problems.push(
        `README app table platform for "${row.name}" is "${row.platform}", apps.json says "${app.platform}"`
      );
    }
    const link = app.homepage || app.github;
    if (link && link !== row.url) {
      problems.push(
        `README app table link for "${row.name}" is "${row.url}", apps.json says "${link}"`
      );
    }
  }

  for (const app of byName.keys()) {
    if (!rows.some((row) => row.name === app)) {
      problems.push(`README app table is missing "${app}", which is in apps.json`);
    }
  }

  return problems;
}

const validate = ajv.compile(schema);
const valid = validate(data);
const isRepoDataFile = dataPath === path.join(__dirname, "apps.json");
const relPath = path.relative(process.cwd(), dataPath);

// Reference and README checks run even when schema validation fails. Both
// helpers are defensive about missing/mistyped fields, and gating them on a
// clean schema pass meant one schema error hid every cross-reference and
// README error behind it — turning a single broken commit into a fix-push-fail
// loop, one layer per round trip.
const referenceProblems = checkReferences(data).concat(
  isRepoDataFile ? checkReadme(data) : []
);

if (!valid) {
  console.error(`✗ ${relPath} failed schema validation:\n`);
  for (const err of validate.errors) {
    const location = err.instancePath || "(root)";
    console.error(`  - ${location} ${err.message}`);
    if (err.params) {
      const extra = Object.entries(err.params)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      if (extra) console.error(`    (${extra})`);
    }
  }
  console.error(`\n${validate.errors.length} schema error(s) found.`);
}

if (referenceProblems.length > 0) {
  console.error(`${valid ? "" : "\n"}✗ ${relPath} failed reference validation:\n`);
  for (const problem of referenceProblems) {
    console.error(`  - ${problem}`);
  }
  console.error(`\n${referenceProblems.length} reference error(s) found.`);
}

if (valid && referenceProblems.length === 0) {
  const appCount = Array.isArray(data.apps) ? data.apps.length : 0;
  console.log(`✓ ${relPath} is valid against apps.schema.json (${appCount} app(s)).`);
  process.exit(0);
}

process.exit(1);
