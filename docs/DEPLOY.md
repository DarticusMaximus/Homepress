# Deploy (self-host with Podman Compose)

Bring up the Homepress **web** and **worker** containers against your own Appwrite and (optionally) SMTP. This stack starts **only** those two services — Appwrite and mail are **external** and are **not started by** compose.

**Status:** `0.1.6` is an **alpha** release — suitable for personal / lab use, not production hardening.

## Prerequisites

Before you compose up, have the following ready:

- **Reachable Appwrite** — hosted Cloud or self-hosted, as long as the host running compose can reach the API endpoint. This guide does not cover installing Appwrite; use the [official Appwrite docs](https://appwrite.io/docs) if you need to stand one up.
- **Appwrite project** with these values for `.env`:
  - `NEXT_PUBLIC_APPWRITE_ENDPOINT`
  - `NEXT_PUBLIC_APPWRITE_PROJECT_ID`
  - `NEXT_PUBLIC_APPWRITE_PROJECT_NAME`
- **Server API key** — `APPWRITE_API_KEY` with database, storage, and **users** scopes sufficient for this app (create under Appwrite Console → project → API keys). Users read/write is required for operator bootstrap and in-app household accounts.
- **Operator email** — `HOMEPRESS_OPERATOR_EMAIL` in `.env`. There is no in-app signup. After compose is up, run `pnpm run bootstrap:operator` (see [Operator and household accounts](#operator-and-household-accounts)) and log in at `/login` with that account.
- **OpenRouter** — `OPENROUTER_API_KEY` for pipeline LLM calls.
- **Podman** (primary / committed verified path), with Compose support (`podman compose`), **or** Docker Engine / a GUI such as Komodo that can pull GHCR images and apply env vars.

## Configure environment

From the repo root (or next to your compose file):

```bash
cp .env.example .env
```

Edit `.env`. Grouping matches `.env.example`:

| Group                       | Variables                                                                                                                                         | First smoke?                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required**                | `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, `NEXT_PUBLIC_APPWRITE_PROJECT_NAME`, `APPWRITE_API_KEY`, `OPENROUTER_API_KEY` | Yes — fill these before `up`                                                                                                                             |
| **Bootstrap (first login)** | `HOMEPRESS_OPERATOR_EMAIL`                                                                                                                        | Required before `pnpm run bootstrap:operator`. Not read by the running web/worker containers.                                                            |
| **Optional (delivery)**     | `SMTP_*`, `APP_PUBLIC_URL`                                                                                                                        | **Not required** for first smoke. SMTP is needed when you send issue email from the UI; `APP_PUBLIC_URL` is needed for absolute RSS / Delivery feed URLs |
| **Optional knobs**          | `CROSS_RUN_SIMILARITY_THRESHOLD`, model overrides, worker poll intervals, scraper, `TZ`                                                           | Defaults are fine to leave blank or at template values                                                                                                   |

All of these are **runtime** container env (via `env_file` / your orchestrator). Changing Appwrite endpoint or project does **not** require rebuilding images — restart/recreate the containers after editing `.env`.

`SETTINGS_SECRET_KEY` encrypts GUI-stored OpenRouter and SMTP secrets at rest (AES-256-GCM). Generate a 64-hex-character key and put it in the **one** `.env` both containers read via `env_file` — the value must be identical for web and worker. Unset is allowed (plaintext storage plus a Settings warning); rotating or losing the key makes stored secrets unreadable until they are re-entered.

```bash
openssl rand -hex 32
```

### Web port binding

The `web` service publishes its port as `"${WEB_BIND_ADDR:-127.0.0.1}:3000:3000"` — **loopback-only by default**. The intended exposure model is a reverse proxy with TLS in front (e.g. Nginx Proxy Manager or Caddy on the same host proxying to `127.0.0.1:3000`); the app port is not meant to be directly internet-facing.

Override `WEB_BIND_ADDR` in `.env` (compose reads it from the project root automatically) only when something outside the host must reach `:3000` directly — a reverse proxy running in another container or on another host, or direct LAN access:

```bash
WEB_BIND_ADDR=0.0.0.0   # all interfaces — or a specific interface IP
```

Do **not** set it empty: the `:-` interpolation form treats set-but-empty as unset and silently falls back to loopback, silently ignoring the override intent.

**Migration note (≤0.1.5):** deployments that relied on reaching `:3000` directly from other machines must set `WEB_BIND_ADDR` **before upgrading** — after the upgrade the port binds to loopback only and off-host clients stop reaching it.

When binding a non-loopback address, the operator's assumption is that the host sits behind a firewall/VPN or a reverse proxy with TLS — `0.0.0.0` exposes the app port on every network the host can reach.

## Option A — Pull prebuilt images (recommended)

Published to GitHub Container Registry on each `v*` tag / GitHub Release:

| Service | Image                                            |
| ------- | ------------------------------------------------ |
| web     | `ghcr.io/darticusmaximus/homepress-web:0.1.6`    |
| worker  | `ghcr.io/darticusmaximus/homepress-worker:0.1.6` |

Also tagged `:0.1.6-alpha`, `:alpha`, and `:latest` (**linux/amd64** — typical Komodo/VPS hosts).

```bash
cp .env.example .env   # fill required keys
podman compose pull
podman compose up -d
```

**Komodo / Docker GUI:** create a stack from this repo’s `compose.yaml` (or paste the two `image:` lines), attach the same env vars as `.env.example`, and deploy. No build step needed.

If GHCR asks for auth on a public package, log in once (`podman login ghcr.io` with a GitHub PAT that has `read:packages`), or make the packages public under the repo’s Packages settings after the first release publish.

## Option B — Build from source

```bash
cp .env.example .env   # fill required keys
podman compose build
podman compose up -d
```

Useful follow-ups:

```bash
podman compose ps
podman compose logs -f web
podman compose logs -f worker
```

Stop with `podman compose down`.

## Smoke checks (both)

### 1. Compose web healthcheck

The `web` service healthcheck already probes `http://localhost:3000/health`. When the container is **healthy**, that probe got HTTP **200**, which means the Appwrite handshake succeeded.

```bash
podman compose ps
```

Look for `homepress-web` as healthy (and `homepress-worker` running).

### 2. Explicit curl

```bash
curl -sf http://localhost:3000/health
```

Expect HTTP **200** and JSON containing top-level `"status":"ok"`:

```json
{ "status": "ok" }
```

A **200** means the Appwrite handshake succeeded. The response does **not** include Appwrite endpoint, project, or authentication details — those stay off the public probe.

If Appwrite is wrong or unreachable, `/health` returns **503** with `"status":"degraded"` and the fixed message `"Appwrite handshake failed"`:

```json
{ "status": "degraded", "message": "Appwrite handshake failed" }
```

## Operator and household accounts

Homepress has no sign-up page. The first account is an **operator**, created or labeled by a one-shot bootstrap script. The operator then creates household **reader** accounts in-app.

### Bootstrap the operator

1. Set `HOMEPRESS_OPERATOR_EMAIL` in `.env` to the address you will log in with.
2. From the repo root, with Node 22+ and dependencies installed:

```bash
pnpm run bootstrap:operator
```

The script loads repo-root `.env` with Node's `process.loadEnvFile` when that file exists. A missing `.env` does **not** crash Node before the script runs — it prints setup instructions and exits non-zero. (We do not pass `node --env-file=` from the npm script for that reason.) It also needs the Appwrite connection keys already in `.env`: `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, and `APPWRITE_API_KEY` (Users read/write scopes).

Behavior:

- **No user with that email** — creates the account with a generated 16-character password, **prints the password once**, then applies the `operator` label. Save the password; it is not stored in `.env` and will not be printed again.
- **User exists without the label** — adds `operator` and keeps any other labels (`updateLabels` replaces the whole set, so the script writes the union).
- **User is already an operator** — prints `already-operator` and exits 0. Safe to re-run.
- **Missing `HOMEPRESS_OPERATOR_EMAIL` or Appwrite connection env** — exits non-zero with setup instructions.

Run this **once after deploy**. Until it succeeds, nobody can open the factory (`/admin/**`). Then log in at `/login` with that email and password.

### Household readers

After you are in as operator, open **Admin → Accounts** and create readers (name optional, email, password you choose — at least 8 characters). Readers can use Home, newsletter channels, issues, and listen. They cannot reach factory pages, factory actions, or issue export.

There is no client-side sign-up. Appwrite's per-project users limit (Console → Auth → Security) only blocks those client-side sign-up endpoints. Homepress never calls them. Operator-created accounts (and this bootstrap script) use the server SDK, which is **not** subject to that limit. The Appwrite default is unlimited — you do **not** need to raise a users cap for household invites.

Additional operators are not created in-app. Promote in the Appwrite Console by adding the `operator` label.

## Human confirmation

1. Open [http://localhost:3000](http://localhost:3000).
2. Log in at `/login` with the operator email/password from `pnpm run bootstrap:operator` (or an existing Appwrite Auth account that script labeled).
3. You should land on the dashboard. An operator can open Admin; a reader cannot.

## Schema note

The **worker** provisions the app database and collections on boot. There is no manual schema migration step for a fresh deploy — keep the worker up so provisioning can run.

## Common failures / troubleshooting

| Symptom                                                       | Likely cause                                                                                                                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web **unhealthy** / `/health` **503** / `"status":"degraded"` | Wrong or missing Appwrite env (`NEXT_PUBLIC_APPWRITE_*`, `APPWRITE_API_KEY`), unreachable endpoint, or API key without enough scope                                          |
| Dashboard / schema unhappy; collections missing               | Worker down or never finished boot — schema is not provisioned without a healthy worker                                                                                      |
| Login fails                                                   | Operator not bootstrapped, or wrong credentials. Run `pnpm run bootstrap:operator` and use the printed password (new user) or the existing account's password (labeled user) |
| Blank SMTP                                                    | Fine for first smoke — email send fails later until `SMTP_*` is set                                                                                                          |
| Absolute RSS / Delivery URLs wrong or empty                   | Set `APP_PUBLIC_URL` to the public origin (no trailing slash) when you need those                                                                                            |
| Cannot pull from GHCR                                         | Package still private after first publish — set visibility to Public, or `podman login ghcr.io`                                                                              |

## Docker compatibility

The same `compose.yaml` often works with `docker compose` (e.g. `docker compose pull && docker compose up -d`). **Only Podman** (`podman compose`) is the committed, verified path for this repo.
