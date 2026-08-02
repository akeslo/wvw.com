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
 * Cross-reference checks the JSON Schema cannot express: app ids must be
 * unique (they are used in URLs and for deduplication), every featured entry
 * must point at a real app, and every app category must exist in `categories`.
 * Without these, a typo ships a broken storefront while CI stays green.
 */
function checkReferences(doc) {
  const problems = [];
  const apps = Array.isArray(doc.apps) ? doc.apps : [];
  const categories = Array.isArray(doc.categories) ? doc.categories : [];

  const appIds = apps.map((app) => app && app.id).filter((id) => typeof id === "string");
  const seen = new Set();
  const duplicates = new Set();
  for (const id of appIds) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  for (const id of duplicates) {
    problems.push(`/apps duplicate app id "${id}"`);
  }

  const categoryIds = new Set(
    categories.map((cat) => cat && cat.id).filter((id) => typeof id === "string")
  );

  const featured = Array.isArray(doc.featured) ? doc.featured : [];
  featured.forEach((entry, index) => {
    if (entry && typeof entry.id === "string" && !seen.has(entry.id)) {
      problems.push(`/featured/${index}/id "${entry.id}" does not match any app id`);
    }
  });

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

function checkReadme(doc) {
  const problems = [];
  const readmePath = path.join(__dirname, "README.md");
  if (!fs.existsSync(readmePath)) return problems;

  const rows = [...fs.readFileSync(readmePath, "utf8").matchAll(README_ROW)].map(
    (m) => ({ name: m[1], url: m[2], platform: m[3].trim() })
  );
  if (rows.length === 0) return problems;

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
const referenceProblems = valid
  ? checkReferences(data).concat(isRepoDataFile ? checkReadme(data) : [])
  : [];

if (referenceProblems.length > 0) {
  console.error(
    `✗ ${path.relative(process.cwd(), dataPath)} failed reference validation:\n`
  );
  for (const problem of referenceProblems) {
    console.error(`  - ${problem}`);
  }
  console.error(`\n${referenceProblems.length} error(s) found.`);
  process.exit(1);
}

if (valid) {
  const appCount = Array.isArray(data.apps) ? data.apps.length : 0;
  console.log(`✓ ${path.relative(process.cwd(), dataPath)} is valid against apps.schema.json (${appCount} app(s)).`);
  process.exit(0);
} else {
  console.error(`✗ ${path.relative(process.cwd(), dataPath)} failed schema validation:\n`);
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
  console.error(`\n${validate.errors.length} error(s) found.`);
  process.exit(1);
}
