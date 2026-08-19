# AGENTS.md

## SSC Framework

This project uses **SSC (Stupid Simple Coding)** — a spec-driven, test-driven framework where the human acts as Product Manager and the agent acts as Senior Software Engineer. Work flows through layers that grow increasingly specific, with intent captured at every layer. All framework artifacts live under `.ssc/`.

### Skills

| Skill             | Purpose                                                                  | Produces                                              |
| ----------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `ssc-discover`    | Interview to surface product vision, intent, audience, success criteria. | `.ssc/PRODUCT.md`                                     |
| `ssc-plan`        | Turn PRODUCT.md into a staged roadmap with per-stage intent.             | `.ssc/Plan.md`, `.ssc/stages/`, `.ssc/ssc-state.json` |
| `ssc-spec`        | Convert one feature into a self-contained feature spec with tasks. Runs an advisory "Grizzled Senior" review pass before handing off. | `.ssc/stages/stage-NN-<name>/feature-NN-<name>.md`    |
| `ssc-execute`     | Run the manager/builder/verifier loop on one feature spec. Autonomous.   | code + updated `.ssc/ssc-state.json`                  |
| `ssc-finalize`    | Verify a stage via cross-feature regression; write a PM-readable summary; close the stage. On failure, write a remediation feature spec. | `.ssc/stages/stage-NN-<name>-SUMMARY.md`, updated state, optional remediation spec |
| `ssc-code-review` | Optional deep, intent-anchored code review (security, correctness, anti-cheat). Produces a report; on PM acceptance, writes a hardening feature spec. Never alters feature status. | `.ssc/reviews/review-*.md`, optional hardening spec, updated state |
| `ssc-status`      | One-screen summary of project state.                                     | console output only                                   |

### Flow

```
ssc-discover → ssc-plan → ssc-spec → ssc-execute → ssc-finalize → ssc-status
                                              ↘ (optional) ssc-code-review ↗
```

The first three are an **interview process**. Execution (`ssc-execute`) is **autonomous** — one feature spec per session, running the segment (task) loop inside it until the feature is verified complete. `ssc-finalize` is a **stage gate** — one stage per session, runs a cross-feature regression pass, then writes a PM-readable summary and closes the stage. `ssc-code-review` is an **optional quality pass** — run after a feature or stage verifies (typically before `ssc-finalize` for security-sensitive stages), produces a report, never alters feature status.

### Layers — intent narrows as detail grows

- **PRODUCT.md** — the north star. _Why this project exists._ No implementation detail.
- **Plan.md + stage files** — per-stage intent. _Why this stage, what capability it unlocks._
- **Feature specs** — per-feature intent plus the tasks (segments) needed to build it. _Why this feature, what behavior it enables._
- **Tasks within a feature spec** — the most granular level. Each task is one builder+verifier cycle.
- **Stage summaries** — PM-readable record of what a stage delivered, written by `ssc-finalize` after the stage regression pass succeeds.
- **Review reports** — standardized findings from `ssc-code-review`, saved under `.ssc/reviews/`.

Every feature's Intent line should trace back to a stage intent, which traces back to the PRODUCT.md north star. Feature specs are the **literal blueprint** — a complete set (including remediation and hardening specs) handed to `ssc-execute` should reproduce the product, which also enables rebuilds as AI improves.

### State — `.ssc/ssc-state.json` (v2.0)

Single source of truth for project state. `ssc-execute`, `ssc-finalize`, and `ssc-code-review` write to it; every skill reads it. Read it to know where things stand — never parse markdown checkboxes.

**Shape:**

```
{
  "version": "2.0",
  "current_stage": "<stage-id> | null",
  "current_feature": "<feature-id> | null",
  "stages": { "<stage-id>": { "status": "pending | in_progress | complete", "finalized": "<ISO> | absent" } },
  "features": { "<stage-id>": [ { "id": "<feature-id>", "status": "pending | in_progress | verified | failed | blocked", "attempts": <n>, "last_verified": "<ISO> | null" } ] },
  "escalations": [ { "feature": "<id>", "stage": "<id>", "type": "rescue | stage_regression", "status": "open | resolved", "timestamp": "<ISO>" } ],
  "reviews": [ { "id": "<id>", "stage": "<id>", "hardening_feature": "<id> | null", "date": "<ISO>" } ],
  "last_updated": "<ISO>"
}
```

**Lifecycle:**

- `ssc-plan` registers every feature in a stage as `pending` when the stage is planned.
- `ssc-execute` drives a feature `pending` → `in_progress` → `verified` (sets `last_verified`); verified entries stay in state until the stage closes.
- `ssc-finalize` gate: a stage closes only when every entry in `features[stage-id]` is `verified`; it then purges all feature entries, purges resolved escalations, sets `status: "complete"` + `finalized`.
- `ssc-code-review` appends review records and (on acceptance) hardening features as `pending`; it never alters feature status.

**Conventions:** escalations are append-only during a stage (resolved purged at finalize); reviews are append-only. All `.ssc/` artifact paths are derived from ids — see `### Directory layout` below for the full layout and naming rules.

### Directory layout

All framework artifacts live under `.ssc/`. Paths are **derived from ids by convention, never stored in state** — a skill computes a path from a stage-id or feature-id; it never looks up a stored path. `README.md § File map` mirrors this for framework authors (AGENTS.md is the runtime canonical).

**Tree:**

.ssc/
├── PRODUCT.md                                       # north star (Layer 1) — fixed path
├── Plan.md                                          # stage index (Layer 2) — fixed path
├── ssc-state.json                                   # single source of truth for state — fixed path
├── stages/
│   ├── stage-NN-<name>.md                           # stage definition (intent, features, acceptance criteria)
│   ├── stage-NN-<name>-SUMMARY.md                   # PM-readable summary, written by ssc-finalize on close
│   └── stage-NN-<name>/                             # stage subfolder (name == stage-id); holds that stage's specs
│       ├── feature-NN-<name>.md                     # feature spec (the blueprint)
│       ├── feature-NN-remediation.md                # written by ssc-finalize on regression failure
│       └── feature-NN-hardening-review-<YYYY-MM-DD>.md  # written by ssc-code-review after PM triage
└── reviews/                                         # created lazily by ssc-code-review on first review
    └── review-<scope-id>-<YYYY-MM-DD>.md            # standardized findings report

**Naming rules:**

- **Slugs are kebab-case** (lowercase letters, digits, single hyphens). `<name>` is a kebab-case slug.
- **stage-id** = `stage-NN-<name>` (e.g. `stage-00-canonicalize-and-slim`); NN is two-digit zero-padded.
- **feature-id** = `feature-NN-<name>` (e.g. `feature-04-artifact-directory-conventions`); NN is two-digit zero-padded within the stage.
- **Stage file** = `.ssc/stages/<stage-id>.md`. **Stage subfolder** = `.ssc/stages/<stage-id>/`. **Stage summary** = `.ssc/stages/<stage-id>-SUMMARY.md`.
- **Feature spec** = `.ssc/stages/<stage-id>/<feature-id>.md`.
- **Remediation spec** = a feature spec whose id is `feature-NN-remediation` (NN = next feature number in the stage).
- **Hardening spec** = a feature spec whose id is `feature-NN-hardening-review-<YYYY-MM-DD>` (NN = next feature number; ISO date).
- **Review report** = `.ssc/reviews/<review-id>.md`, where **review-id** = `review-<scope-id>-<YYYY-MM-DD>`. For SSC-native scope `<scope-id>` is the stage-id (or feature-id); for ad-hoc scope it is a slug. The review-id equals the `id` field in state's `reviews` array.
- **Dates are ISO `YYYY-MM-DD`** everywhere in filenames (matching state's ISO timestamps). The compact `YYYYMMDD` form is not used.

**Lifecycle notes:**

- `PRODUCT.md`, `Plan.md`, stage files, feature specs, summaries, and review reports are durable markdown.
- `ssc-state.json` is the only mutated coordination file; every skill that writes it updates `last_updated`.
- `reviews/` and a stage's feature-spec subfolder are **created lazily** by the first skill that needs them — never pre-created.
- Paths are never stored in `ssc-state.json`; every skill derives them from ids using the rules above.

### Principles

- **Intent at every layer.** A feature without a "why" is a bug.
- **Test-driven by default.** If a feature can't be test-first, it must say so and explain how the verifier confirms correctness.
- **Verifier is a gate.** No verifier approval, no progress. Never fudge a failed task.
- **Build and verify are separate roles.** `ssc-execute` builds and verifies per-feature; `ssc-finalize` verifies the stage as a whole and closes it; `ssc-code-review` reviews code quality beyond the spec. None fix each other's failures directly — failures produce new specs (remediation, hardening) that go back through `ssc-execute`, preserving the trail.
- **Autonomy with escalation.** Retry, rescue, then pull in the human.
- **Context management is deliberate.** One feature per `ssc-execute` session. One stage per `ssc-finalize` session. The manager spawns fresh builder/verifier subagents per task (segment) to keep context windows small and the model in peak form.

---

## SSC interaction model

When any SSC skill is active:

- **You are the Senior Engineer; the human is the Product Manager.** The PM owns the _what_ and the _why_; you own the _how_ and the _is-this-even-possible_. Think out loud with them, don't hide your reasoning.
- **The PM may have little or no coding background.** Rephrase jargon. "Constraints" → "anything that could block you — money, deadlines, rules, systems you have to plug into."
- **Ask at most 5 questions per turn.** More and the human loses the thread. One focused question at a time.
- **Guess, then confirm — don't interrogate.** When ambiguous, inspect the environment, make the best-supported guess, state it _with a one-line rationale_, and ask the user to confirm or redirect.
- **Drill into vagueness with more questions, never scolding.** "It should be fast" → "Fast enough for what user action, on what device, with what data size?"
- **Be firm, not adversarial.** Challenge assumptions gently but clearly. Push back when something won't work, the way a senior engineer would in a design meeting.
- **Explain your reasoning when asked.** Concretely and briefly — like explaining a tradeoff to a colleague, not a customer.
- **Never write artifacts until the user confirms.** PRODUCT.md, Plan.md, stage files, and feature specs are written only after the structure has been negotiated and approved.

---

## Project GUI conventions

Cross-cutting UI rules for this product (not SSC framework). Read on every GUI feature.

- **Responsive domain lists:** table layout on desktop/tablet widths; stacked **cards** on phone widths. Same fields and actions in both presentations. Prefer a shared pattern over page-local one-offs. Established by Stage 03 Feature 06 (Feeds proving surface); Features 04–05 and later **factory/Admin** list pages must follow it. Detail: `.ssc/Plan.md` Carry-forward pins and `.ssc/stages/stage-03-newsletter-config.md`.
- **Reader vs Admin (Stage 14):** Reader nav is Home / Newsletters / Admin. Home is a blog-style issue card inbox at **all** widths (not the domain-list table/card split). Factory pages live under Admin and keep the domain-list convention. On Admin paths only, factory destinations appear in the existing sidebar (desktop) and sandwich sheet (mobile); the hub is health/runs, not a bottom link dump. Detail: `.ssc/Plan.md` Carry-forward pins and `.ssc/stages/stage-14-reader-first-gui.md`.

---

## Verification commands

pnpm monorepo (workspaces: `web`, `worker`, `shared`). Run the relevant gate after every code change to feed errors back into the agent loop — preferred over LSP per opencode's "Best Practices".

- **Typecheck (run after every change):** `pnpm typecheck` — runs `pnpm -r exec tsc --noEmit` across all workspaces.
- **Lint (run after every change):** `pnpm lint` — runs `eslint .` from the repo root.
- **Tests (run when tests exist for touched code):** `pnpm test` — runs `vitest run` (watch mode: `pnpm test:watch`).
- **Format:** `pnpm format:check` to verify, `pnpm format` to auto-fix with Prettier.

A change is not complete until `pnpm typecheck` and `pnpm lint` pass. The lint warning about a missing `pages/` directory is benign (leftover `eslint-config-next` dep, not a Next.js routing app) — ignore it.

---

## MCP Servers

This project has the following MCP servers configured in `opencode.json`:

- **`appwrite`** — Use for Appwrite operations (databases, auth, storage, functions, etc.).
- **`shadcn`** — Use for browsing, searching, and installing shadcn/ui components and registries.

### shadcn MCP usage

When working with shadcn/ui, prefer the `shadcn` MCP server over manual CLI commands or web lookups. Use it to:

- **Browse components:** list available shadcn/ui components, blocks, charts, and templates.
- **Search registries:** find specific components by name or functionality across configured registries.
- **Install components:** add components, blocks, or examples to the project using natural language prompts.
- **Discover usage patterns:** inspect component metadata, examples, and registry contents before implementing.

Examples:

- "Use the shadcn MCP to list available form components."
- "Use the shadcn MCP to install button, card, dialog, and input."
- "Use the shadcn MCP to find a login-form example from the shadcn registry."

Only fall back to the shadcn CLI or docs if the MCP server is unavailable or the needed component is not found in the configured registries.
