# Homepress

Self-hosted press for turning RSS feeds into curated newsletter issues through an AI pipeline (fetch → scrape → tag → score → select → draft), with an operator GUI for feeds, newsletters, runs, issues, schedules, and delivery. You bring your own Appwrite project and OpenRouter API key; web and worker run via Podman Compose (or local pnpm).

## What's included

pnpm monorepo with three workspace packages:

| Package  | Role |
| -------- | ---- |
| `web`    | Next.js operator UI and public routes (`/health`, RSS) |
| `worker` | Background pipeline runner, schema provisioner, schedules |
| `shared` | Shared libraries (Appwrite clients, pipeline, schema, delivery) |

## Deploy

Self-host web + worker with Podman Compose against your own Appwrite.

**Prerequisites:** Linux box (or equivalent); Podman; a reachable Appwrite project; an OpenRouter API key; one operator Auth user (email/password) in that project.

```sh
cp .env.example .env
# Fill required keys in .env (Appwrite endpoint/project, APPWRITE_API_KEY, OPENROUTER_API_KEY)
podman compose up -d
# Wait until the web service is healthy, then:
curl -sf http://localhost:3000/health
```

Full stranger walkthrough (env groups, smoke checks, troubleshooting): [docs/DEPLOY.md](docs/DEPLOY.md).

The same `compose.yaml` often works with `docker compose`, but **only Podman is the committed verified path**.

## Prerequisites

- Node >= 22 (see `.nvmrc`)
- pnpm 11.9.0

## Getting started

```sh
pnpm install
```

## Common scripts

All commands below run from the **repository root**. The root `eslint.config.mjs`,
`vitest.config.ts`, and Prettier config span all three workspace packages via globs,
so there are no per-package `lint`/`test` scripts — run them from the root.

| Command             | Description                                       |
| ------------------- | ------------------------------------------------- |
| `pnpm dev`          | Start the Next.js dev server (`web`).             |
| `pnpm dev:worker`   | Start the worker (`worker`).                      |
| `pnpm build`        | Build all packages (`pnpm -r build`).             |
| `pnpm typecheck`    | Type-check all packages (`pnpm -r exec tsc ...`). |
| `pnpm test`         | Run the test suite once (Vitest).                 |
| `pnpm test:watch`   | Run Vitest in watch mode.                         |
| `pnpm lint`         | Lint the whole repo (ESLint flat config).         |
| `pnpm format`       | Rewrite files with Prettier.                      |
| `pnpm format:check` | Verify Prettier formatting without writing.       |

The quality gate run from a clean checkout is:

```sh
pnpm install && pnpm lint && pnpm test && pnpm format:check
```

## Environment

Copy `.env.example` to `.env` and fill in the real secrets (Appwrite endpoint/project
credentials, `APPWRITE_API_KEY`, `OPENROUTER_API_KEY`). The local `.env` is gitignored;
`.env.example` is the committed template.

### `CROSS_RUN_SIMILARITY_THRESHOLD`

Cosine similarity over **title + tags** embeddings used by cross-run topic suppression.
A candidate whose maximum similarity to any retained previous-run item is **at or above**
(`>=`) the threshold is hard-dropped before MMR selection. There is no GUI for this knob.

| Property    | Value                                                                   |
| ----------- | ----------------------------------------------------------------------- |
| Default     | `0.85`                                                                  |
| Valid range | `[0, 1]` — finite numbers are clamped to the range                      |
| Fallback    | empty / `NaN` / non-finite values resolve to the `0.85` default         |
| Direction   | higher = stricter (more suppressions); lower = looser                   |
| Scope       | global (all newsletters); per-newsletter tuning uses the lookback field |

Editing `.env` does **not** hot-reload. The worker reads `.env` once at boot
(`process.loadEnvFile`); under compose, `env_file: .env` is injected at container start.
**Restart the worker** (or recreate the compose `worker` service) after changing the value
so the next run uses the new threshold — no application code change is required.

## Security

Do not commit secrets. See [SECURITY.md](SECURITY.md) for reporting vulnerabilities, rotation guidance, and the intentional minimal `/health` contract.

## License

[MIT](LICENSE) © 2026 Aaron Lockard
