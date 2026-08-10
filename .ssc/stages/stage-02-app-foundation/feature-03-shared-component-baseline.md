# Feature 03: Shared component baseline + visual language

## Intent

Extend the shadcn/ui + Tailwind shell established in Feature 02 by installing and wiring the shared component primitives that every later GUI stage will import, plus a global toast stack, and prove them in one hidden demo page so the operator can see the visual language in action.

## Spec

Feature 02 already pinned the GUI contract: shadcn/ui on Tailwind CSS v4, `next-themes` class-based light/dark, and the sidebar/nav shell. This feature adds the **reusable component layer** on top.

The feature installs the following shadcn/ui primitives into `web/components/ui/`: `button`, `card`, `input`, `label`, `textarea`, `select`, `dialog`, `table`, `badge`, and `sonner`. It also installs any Radix primitives and peer dependencies the shadcn CLI pulls in for those components. These are the shared building blocks later stages use for forms, tables, modals, status badges, and toasts.

It wires a global toast stack:
- `web/components/ui/sonner.tsx` — the shadcn-generated `Toaster` wrapper around `sonner`.
- `web/components/toast-provider.tsx` — a thin client component that mounts `<Toaster />` with sensible defaults (`position="bottom-right"`, `closeButton`, `richColors`, `duration={4000}`).
- `web/lib/toast.ts` — a small wrapper that re-exports `toast` from `sonner` with typed helpers: `toast.success`, `toast.error`, `toast.info`, `toast.warning`. This is the only toast API later stages import.

It creates a hidden **design-system demo page** at `web/app/(protected)/design-system/page.tsx` (not linked from the sidebar) that exercises every baselined primitive and all toast variants in grouped sections:
- Buttons (variants: default, secondary, outline, ghost, destructive; sizes: default, sm, lg, icon)
- Inputs (text, password, number, disabled, with error state via `aria-invalid`)
- Textarea (default, disabled)
- Select (single select with a few options)
- Dialog (trigger button opens a modal with header, body text, footer buttons)
- Table (a small static table with head/body/rows/cells)
- Card (header, title, description, content, footer)
- Badge (default, secondary, outline, destructive)
- Toast demo buttons (success, error, info, warning) that call the `toast` helpers so the PM can verify the toast stack end-to-end.

The page is intentionally not in the nav and not indexed; it exists for manual verification and future reference only.

A single automated integration test confirms the toast provider actually renders a toast when invoked:
- `web/src/__tests__/toast-provider.test.tsx` mounts `<ToastProvider />`, calls `toast.success("Saved")`, and asserts the toast text appears in the document.

## Dependencies

- Builds on: feature-02 `gui-shell` (shadcn/ui + Tailwind v4 theme, `next-themes`, sidebar layout, nav routes, and auth gate). This feature does not work unless Feature 02's shell exists first.
- Orphaned by: none — third feature in stage 02.

## Constraints

- **The visual language pinned by Feature 02 + 03 is binding on later stages.** Later GUI stages (feature 04 in stage 02, and stages 03–09) use the shared primitives and toast stack established here; they do NOT introduce a second component library or alternate styling approach.
- **No new routes beyond `/design-system`.** This feature does not add nav items or alter the pinned six-route nav structure from Feature 02.
- **Toast API is `toast` from `web/lib/toast.ts` only.** Later stages do not import `sonner` directly.
- **No domain data or DB access in this feature.** The design-system page is static; it does not read or write Appwrite.
- **`Input type="number"` is the baseline numeric input.** A dedicated numeric stepper component is deferred until a later stage needs one.
- **Form validation libraries are out of scope.** Feature 03 provides controlled primitives only. `react-hook-form` + `zod` will be added when the first real form feature arrives.
- **No changes to `shared/`, `worker/`, auth code, or the six pinned routes.** This feature lives entirely inside `web/`.
- **No changes to `web/app/globals.css` tokens.** Feature 02 owns the theme token file; this feature consumes it.

## Acceptance criteria

- [ ] shadcn/ui primitives for `button`, `card`, `input`, `label`, `textarea`, `select`, `dialog`, `table`, `badge`, and `sonner` are installed under `web/components/ui/` and build cleanly.
- [ ] `web/components/toast-provider.tsx` mounts `<Toaster />` with `position="bottom-right"`, `closeButton`, `richColors`, and `duration={4000}`.
- [ ] `web/lib/toast.ts` re-exports `toast` from `sonner` and exposes `toast.success`, `toast.error`, `toast.info`, `toast.warning` typed helpers.
- [ ] `web/app/layout.tsx` (or another appropriate root-level layout) renders `<ToastProvider />` so toasts are available app-wide behind auth.
- [ ] `web/app/(protected)/design-system/page.tsx` exists and renders grouped demos of Button, Input, Label, Textarea, Select, Dialog, Table, Card, Badge, and all four toast variants.
- [ ] `web/src/__tests__/toast-provider.test.tsx` exists and passes: it renders the provider, calls `toast.success("Saved")`, and finds the toast text.
- [ ] `pnpm --filter web build` exits zero.
- [ ] `pnpm typecheck` exits zero across `shared`, `web`, `worker`.
- [ ] `pnpm lint` exits zero.
- [ ] `pnpm test` exits zero (new toast test + all existing tests green).
- [ ] The six pinned nav routes from Feature 02 still resolve without error; no new nav items are added.

## Files

- Create: `web/components/ui/textarea.tsx`
- Create: `web/components/ui/select.tsx`
- Create: `web/components/ui/dialog.tsx`
- Create: `web/components/ui/table.tsx`
- Create: `web/components/ui/badge.tsx`
- Create: `web/components/ui/sonner.tsx`
- Create: `web/components/toast-provider.tsx`
- Create: `web/lib/toast.ts`
- Create: `web/app/(protected)/design-system/page.tsx`
- Create: `web/src/__tests__/toast-provider.test.tsx`
- Modify: `web/app/layout.tsx` (render `<ToastProvider />` alongside `<ThemeProvider>` children)
- Modify: `web/package.json` (add shadcn/Radix/sonner peer dependencies via the shadcn CLI / `pnpm add`)

## Testing approach

**Mostly not test-first — this is a visual/component baseline feature.** Automated tests asserting shadcn wrappers render themselves add little value and create brittle snapshots. The meaningful automated coverage is one integration test for the toast stack, because it exercises a client-only global provider and a third-party library boundary.

Automated verification:
- `pnpm --filter web build` — catches missing imports, broken JSX, invalid route modules, and type errors in the build path.
- `pnpm typecheck` — catches type drift in the new components and wrappers.
- `pnpm lint` — catches unused imports, React hooks violations, and a11y issues.
- `pnpm test` — runs the new toast integration test plus all existing tests.

Manual verification (PM gate):
- Visit `/design-system` after logging in.
- Confirm every component group renders correctly in both light and dark modes.
- Confirm the Dialog opens and closes.
- Confirm the Select dropdown works.
- Confirm each toast button produces a toast with the correct color/variant.
- Confirm the toast auto-dismisses and the close button works.

## Tasks

### Task 1: Install shadcn primitives and Sonner

- **Action**: In `web/`, run `npx shadcn@latest add textarea select dialog table badge sonner`. This generates `web/components/ui/{textarea,select,dialog,table,badge,sonner}.tsx` and installs their Radix + `sonner` dependencies via `pnpm`. Ensure `web/package.json` is updated with the new dependencies.
- **Expected result**: The six new shadcn component files exist under `web/components/ui/`, `sonner` is installed, and the project still builds.
- **Verify**: Run `pnpm --filter web build` — exits zero. Run `pnpm typecheck` — zero errors. Run `pnpm lint` — zero errors. Confirm the generated files exist.
- **Depends on**: feature-02 (must already be merged/verified; this feature inherits its theme and shell).

### Task 2: Wire the global toast provider and helper

- **Action**: Create `web/components/toast-provider.tsx` as a client component that mounts `<Toaster />` from `@/components/ui/sonner` with props `position="bottom-right"`, `closeButton`, `richColors`, and `duration={4000}`. Create `web/lib/toast.ts` that re-exports `toast` from `sonner` and exports typed convenience helpers: `success(message, options?)`, `error(message, options?)`, `info(message, options?)`, `warning(message, options?)`. Modify `web/app/layout.tsx` to wrap `{children}` with `<ToastProvider />` inside the existing `<ThemeProvider>` so toasts are available app-wide. Ensure the provider is client-safe (it is itself a client component, so mounting in the server-rendered root layout is fine because it renders nothing on the server but its children).
- **Expected result**: A global toast stack is available to every page, and later stages import `toast` only from `web/lib/toast.ts`.
- **Verify**: Run `pnpm --filter web build` — exits zero. Run `pnpm typecheck` — zero errors. Run `pnpm lint` — zero errors. Confirm `web/components/toast-provider.tsx`, `web/lib/toast.ts` exist and `web/app/layout.tsx` renders `<ToastProvider />`.
- **Depends on**: Task 1.

### Task 3: Create the hidden design-system demo page

- **Action**: Create `web/app/(protected)/design-system/page.tsx` as a server component (the individual demo sections may be client components only where interactivity is required: Dialog, Select, toast buttons, and the form-like state for input error demo). The page renders grouped sections with a small heading each:
  - **Buttons**: all Button variants and sizes from `@/components/ui/button`.
  - **Inputs + Label**: text Input, password Input showing hidden text, number Input, disabled Input, and an Input with `aria-invalid` paired with a Label.
  - **Textarea**: default and disabled.
  - **Select**: a shadcn Select with Label and a few options.
  - **Dialog**: a Button that opens a Dialog with header, body, and footer actions.
  - **Table**: a static Table with head/body/rows/cells.
  - **Card**: a Card with header, title, description, content, and footer.
  - **Badge**: default, secondary, outline, destructive Badges.
  - **Toasts**: four Buttons that call `toast.success`, `toast.error`, `toast.info`, `toast.warning` from `web/lib/toast.ts`.
  Keep styling minimal and use only the shared tokens (`bg-background`, `text-foreground`, `p-4`, `gap-4`, etc.). Do not invent ad hoc colors.
- **Expected result**: A single hidden page exercises every baselined primitive and all toast variants.
- **Verify**: Run `pnpm --filter web build` — exits zero. Run `pnpm typecheck` — zero errors. Run `pnpm lint` — zero errors. Confirm the page file exists and imports only from `@/components/ui/*` and `@/lib/toast`.
- **Depends on**: Task 2.

### Task 4: Add the toast integration test

- **Action**: Create `web/src/__tests__/toast-provider.test.tsx` using `@testing-library/react`, `@testing-library/jest-dom`, and `vitest`. Render `<ToastProvider />`, call `toast.success("Newsletter saved")`, then `await screen.findByText("Newsletter saved")` and assert it is in the document. Also assert the toast disappears after a wait (or simply assert presence if `duration` is mocked; the minimum is presence). Add the required test dependencies to the root `package.json` devDependencies: `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/dom`, and `jsdom` if not already present. Update `vitest.config.ts` to set `environment: "jsdom"` and add `setupFiles: ["./vitest.setup.ts"]` if `@testing-library/jest-dom` matchers are used. Create `vitest.setup.ts` at the workspace root that imports `@testing-library/jest-dom`.
- **Expected result**: The toast stack has automated coverage that catches a broken provider or missing `sonner` export.
- **Verify**: Run `pnpm test` — the new test passes and all existing tests still pass.
- **Depends on**: Task 2.

### Task 5: Final regression pass

- **Action**: Run the full verification command chain and confirm zero errors. Inspect the diff to ensure no files outside `web/` were changed and no new nav items were added.
- **Expected result**: The feature is ready for the PM manual gate.
- **Verify**: Run `pnpm install && pnpm --filter web build && pnpm typecheck && pnpm lint && pnpm test` — all exit zero.
- **Depends on**: Task 3, Task 4.

## Feature verification

### Stage A — Automated verifier

- Run: `pnpm install && pnpm --filter web build && pnpm typecheck && pnpm lint && pnpm test`
- Expected: All commands exit zero. `pnpm test` includes the new `web/src/__tests__/toast-provider.test.tsx` and all existing `shared/` and `web/src/__tests__/*` tests still pass. No new nav routes appear in `web/components/app-sidebar.tsx`.

### Stage B — PM manual gate

After Stage A passes, the PM visits the running app and confirms:

1. Log in and navigate to `/design-system` (type the URL manually; it is not in the sidebar).
2. **Buttons**: all Button variants and sizes render without visual breakage in both light and dark modes.
3. **Inputs + Label**: text, password, and number inputs render; the disabled input is non-interactive; the invalid input shows the error styling.
4. **Textarea**: default and disabled textareas render.
5. **Select**: clicking the Select trigger opens the dropdown and a choice can be made.
6. **Dialog**: clicking the Dialog trigger opens a modal with a title, body, and a close action; clicking the close action dismisses it.
7. **Table**: the static table has a head row and body rows with clear borders.
8. **Card**: the Card has header, title, description, content, and footer sections.
9. **Badge**: all four Badge variants render.
10. **Toasts**: clicking each of the four toast buttons produces a toast at bottom-right with the correct color (success green, error red, info blue, warning yellow/amber), the toast text is readable, and the close button dismisses it.
11. **No nav changes**: the sidebar still has exactly the six pinned links from Feature 02 in the same order.
12. **Light/dark preserved**: switching the theme toggle updates the design-system page styling consistently.

The manager records the PM's confirmations; on all-yes, it marks the feature `verified`. On any "no," it records the failure reason and retries or escalates.

## Handoff

When complete, the builder reports to the manager:
- The list of files created and modified (new `web/components/ui/*` primitives, `web/components/toast-provider.tsx`, `web/lib/toast.ts`, `web/app/(protected)/design-system/page.tsx`, `web/src/__tests__/toast-provider.test.tsx`, and modified `web/app/layout.tsx`/`web/package.json`, plus any root test config changes).
- Confirmation that `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass.
- The exact import paths for the shared baseline:
  - UI primitives: `@/components/ui/{button,card,input,label,textarea,select,dialog,table,badge,sonner}`
  - Toast API: `@/lib/toast`
  - Toast provider: `@/components/toast-provider`
- Confirmation that `<ToastProvider />` is mounted in the root layout and toasts are app-wide.
- Confirmation that no files outside `web/` were changed, the six pinned nav routes were not altered, and no new nav items were added.
- Any deviation from this spec and the reason (e.g., a shadcn CLI peer-dependency change, a `sonner` API difference, a Tailwind v4 class quirk).
- The PM manual gate checklist so the manager knows to run it before marking verified.
