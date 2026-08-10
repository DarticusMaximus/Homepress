# Deploy (self-host with Podman Compose)

Bring up the Homepress **web** and **worker** containers against your own Appwrite and (optionally) SMTP. This stack starts **only** those two services — Appwrite and mail are **external** and are **not started by** compose.

**Status:** `0.1.0` is an **alpha** release — suitable for personal / lab use, not production hardening.

## Prerequisites

Before you compose up, have the following ready:

- **Reachable Appwrite** — hosted Cloud or self-hosted, as long as the host running compose can reach the API endpoint. This guide does not cover installing Appwrite; use the [official Appwrite docs](https://appwrite.io/docs) if you need to stand one up.
- **Appwrite project** with these values for `.env`:
  - `NEXT_PUBLIC_APPWRITE_ENDPOINT`
  - `NEXT_PUBLIC_APPWRITE_PROJECT_ID`
  - `NEXT_PUBLIC_APPWRITE_PROJECT_NAME`
- **Server API key** — `APPWRITE_API_KEY` with database and storage scopes sufficient for this app (create under Appwrite Console → project → API keys).
- **One operator user** in Appwrite Auth (email/password). There is no in-app signup; you log in at `/login` with that account.
- **OpenRouter** — `OPENROUTER_API_KEY` for pipeline LLM calls.
- **Podman** (primary / committed verified path), with Compose support (`podman compose`), **or** Docker Engine / a GUI such as Komodo that can pull GHCR images and apply env vars.

## Configure environment

From the repo root (or next to your compose file):

```bash
cp .env.example .env
```

Edit `.env`. Grouping matches `.env.example`:

| Group | Variables | First smoke? |
| --- | --- | --- |
| **Required** | `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, `NEXT_PUBLIC_APPWRITE_PROJECT_NAME`, `APPWRITE_API_KEY`, `OPENROUTER_API_KEY` | Yes — fill these before `up` |
| **Optional (delivery)** | `SMTP_*`, `APP_PUBLIC_URL` | **Not required** for first smoke. SMTP is needed when you send issue email from the UI; `APP_PUBLIC_URL` is needed for absolute RSS / Delivery feed URLs |
| **Optional knobs** | `CROSS_RUN_SIMILARITY_THRESHOLD`, model overrides, worker poll intervals, scraper, `TZ` | Defaults are fine to leave blank or at template values |

All of these are **runtime** container env (via `env_file` / your orchestrator). Changing Appwrite endpoint or project does **not** require rebuilding images — restart/recreate the containers after editing `.env`.

## Option A — Pull prebuilt images (recommended)

Published to GitHub Container Registry on each `v*` tag / GitHub Release:

| Service | Image |
| --- | --- |
| web | `ghcr.io/darticusmaximus/homepress-web:0.1.0` |
| worker | `ghcr.io/darticusmaximus/homepress-worker:0.1.0` |

Also tagged `:0.1.0-alpha`, `:alpha`, and `:latest` (**linux/amd64** — typical Komodo/VPS hosts).

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

## Human confirmation

1. Open [http://localhost:3000](http://localhost:3000).
2. Log in at `/login` with the Appwrite Auth operator user (email/password you created in the Console).
3. You should land on the dashboard.

## Schema note

The **worker** provisions the app database and collections on boot. There is no manual schema migration step for a fresh deploy — keep the worker up so provisioning can run.

## Common failures / troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Web **unhealthy** / `/health` **503** / `"status":"degraded"` | Wrong or missing Appwrite env (`NEXT_PUBLIC_APPWRITE_*`, `APPWRITE_API_KEY`), unreachable endpoint, or API key without enough scope |
| Dashboard / schema unhappy; collections missing | Worker down or never finished boot — schema is not provisioned without a healthy worker |
| Login fails | No Appwrite Auth email/password user for this project, or wrong credentials |
| Blank SMTP | Fine for first smoke — email send fails later until `SMTP_*` is set |
| Absolute RSS / Delivery URLs wrong or empty | Set `APP_PUBLIC_URL` to the public origin (no trailing slash) when you need those |
| Cannot pull from GHCR | Package still private after first publish — set visibility to Public, or `podman login ghcr.io` |

## Docker compatibility

The same `compose.yaml` often works with `docker compose` (e.g. `docker compose pull && docker compose up -d`). **Only Podman** (`podman compose`) is the committed, verified path for this repo.
