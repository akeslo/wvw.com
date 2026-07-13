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

const validate = ajv.compile(schema);
const valid = validate(data);

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
