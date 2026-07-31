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

const validate = ajv.compile(schema);
const valid = validate(data);
const referenceProblems = valid ? checkReferences(data) : [];

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
