#!/usr/bin/env node
/* global console, process */
/**
 * One-shot operator bootstrap for Homepress.
 *
 * Usage (from repo root):
 *   pnpm run bootstrap:operator
 *
 * Env loading: this script loads repo-root `.env` with Node 22's
 * `process.loadEnvFile` when the file exists. We do **not** pass
 * `node --env-file=` from package.json — Node aborts before the script
 * runs if that file is missing, and the spec requires setup instructions
 * instead of a boot crash. Existing process env is not overwritten.
 *
 * Requires: HOMEPRESS_OPERATOR_EMAIL, NEXT_PUBLIC_APPWRITE_ENDPOINT,
 * NEXT_PUBLIC_APPWRITE_PROJECT_ID, APPWRITE_API_KEY (Users read/write).
 *
 * This is the only production code allowed to call users.updateLabels.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client, ID, Query, Users } from "node-appwrite";

const OPERATOR_LABEL = "operator";
const PASSWORD_BYTES = 12; // 12 bytes → 16-char base64url
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENV_PATH = resolve(REPO_ROOT, ".env");

const REQUIRED = [
  "HOMEPRESS_OPERATOR_EMAIL",
  "NEXT_PUBLIC_APPWRITE_ENDPOINT",
  "NEXT_PUBLIC_APPWRITE_PROJECT_ID",
  "APPWRITE_API_KEY",
];

function trimPresent(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function printSetupInstructions(missing) {
  const missingList =
    missing.length > 0 ? missing.map((key) => `  ${key}`).join("\n") : "  (see keys below)";

  console.error(`bootstrap:operator: missing configuration.

Copy .env.example to .env at the repo root (if you have not already) and set:

${missingList}

Required keys:
  HOMEPRESS_OPERATOR_EMAIL          operator login email
  NEXT_PUBLIC_APPWRITE_ENDPOINT     Appwrite API endpoint
  NEXT_PUBLIC_APPWRITE_PROJECT_ID   Appwrite project id
  APPWRITE_API_KEY                  server API key with Users read/write scopes

Then run:

  pnpm run bootstrap:operator

Run once after deploy. Without an operator-labeled user, nobody can reach the factory.
`);
}

function generatePassword() {
  return randomBytes(PASSWORD_BYTES).toString("base64url");
}

function loadRepoEnv() {
  if (!existsSync(ENV_PATH)) {
    return;
  }
  try {
    process.loadEnvFile(ENV_PATH);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`bootstrap:operator: could not read ${ENV_PATH}: ${message}`);
  }
}

function ensureOperatorLabels(existing) {
  const labels = Array.isArray(existing) ? [...existing] : [];
  if (!labels.includes(OPERATOR_LABEL)) {
    labels.push(OPERATOR_LABEL);
  }
  return labels;
}

/**
 * Decide what to do with a listed existing user before any updateLabels call.
 * Mismatch must never proceed to labeling (S7).
 *
 * @param {{ email?: unknown, labels?: unknown }} existing
 * @param {string} email lowercase HOMEPRESS_OPERATOR_EMAIL
 * @returns {{ kind: "mismatch", message: string } | { kind: "already-operator" } | { kind: "label", labels: string[] }}
 */
export function existingOperatorPlan(existing, email) {
  if (String(existing.email ?? "").toLowerCase() !== email) {
    return {
      kind: "mismatch",
      message: `listed user email does not match HOMEPRESS_OPERATOR_EMAIL (expected ${email}, got ${String(existing.email ?? "")}). Refusing to label.`,
    };
  }
  const labels = Array.isArray(existing.labels) ? existing.labels : [];
  if (labels.includes(OPERATOR_LABEL)) {
    return { kind: "already-operator" };
  }
  return { kind: "label", labels: ensureOperatorLabels(labels) };
}

async function main() {
  loadRepoEnv();

  const missing = REQUIRED.filter((key) => trimPresent(process.env[key]) === null);
  if (missing.length > 0) {
    printSetupInstructions(missing);
    process.exit(1);
  }

  const email = trimPresent(process.env.HOMEPRESS_OPERATOR_EMAIL).toLowerCase();
  const endpoint = trimPresent(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT);
  const projectId = trimPresent(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID);
  const apiKey = trimPresent(process.env.APPWRITE_API_KEY);

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const users = new Users(client);

  const listed = await users.list({
    queries: [Query.equal("email", email), Query.limit(1)],
  });
  const existing = listed.users[0];

  if (existing) {
    const plan = existingOperatorPlan(existing, email);
    if (plan.kind === "mismatch") {
      console.error(`bootstrap:operator: ${plan.message}`);
      process.exit(1);
    }
    if (plan.kind === "already-operator") {
      console.log(`already-operator: ${email} already has the operator label.`);
      return;
    }
    await users.updateLabels({
      userId: existing.$id,
      labels: plan.labels,
    });
    console.log(`Labeled existing user as operator: ${email}`);
    console.log("Log in at /login with this account's existing password.");
    return;
  }

  const password = generatePassword();
  const created = await users.create({
    userId: ID.unique(),
    email,
    password,
  });
  await users.updateLabels({
    userId: created.$id,
    labels: [OPERATOR_LABEL],
  });

  console.log(`Created operator user: ${email}`);
  console.log(`Password (shown once): ${password}`);
  console.log("Save this password now — it will not be printed again.");
  console.log("Log in at /login with this email and password.");
}

const isDirectRun =
  process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`bootstrap:operator failed: ${message}`);
    console.error(
      "Check NEXT_PUBLIC_APPWRITE_ENDPOINT, NEXT_PUBLIC_APPWRITE_PROJECT_ID, and APPWRITE_API_KEY (Users read/write scopes).",
    );
    process.exit(1);
  });
}
