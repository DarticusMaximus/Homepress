# Feature 02: GUI shell + layout

## Intent

Give the web app a real layout (sidebar nav + content area) behind the existing auth gate, with a dashboard as the default landing and navigation sections that later stages fill in — so every later GUI stage inherits the shell and the pinned theme/nav contract rather than rebuilding scaffolding ad hoc.

## Spec

A responsive sidebar layout rendered inside the existing `(protected)` route group, so the stage-00 auth gate (middleware + `getAuthenticatedUser` redirect) keeps guarding every page. The root `web/app/layout.tsx` wraps the body in a `next-themes` `ThemeProvider` (`defaultTheme="system"`, `enableSystem`, `attribute="class"`, `disableTransitionOnChange`) so light/dark is class-based and the PM's default order is: explicit choice > system preference > dark (the fallback when system preference is unavailable).

The shell is built with shadcn/ui on Tailwind CSS v4. `npx shadcn@latest init` produces `web/components.json` (style `new-york`, `tsx: true`, `rsc: true`, `css: "app/globals.css"`, `baseColor: "neutral"`, `cssVariables: true`, icon library `lucide`), the `@/components/ui`, `@/lib/utils`, `@/hooks` import aliases (already covered by the existing `"@/*": ["./*"]` tsconfig path), and the `cn` helper. `web/app/globals.css` holds the Tailwind v4 theme: `@import "tailwindcss"`, `@plugin "tailwindcss-animate"`, `@custom-variant dark (&:is(.dark *))`, light `:root` and `.dark` CSS-variable blocks (background, foreground, card, primary, accent, muted, border, ring — the full shadcn token set), and the sidebar-specific tokens (`--sidebar-background`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring`) for both light and dark, mapped into `@theme inline` so `bg-sidebar` / `text-sidebar-foreground` / etc. resolve.

The protected layout (`web/app/(protected)/layout.tsx`) becomes a `SidebarProvider` wrapping `AppSidebar` + a `<main>` containing `SidebarTrigger` (the hamburger, visible only below `md`) and `{children}`. shadcn's `Sidebar` handles desktop (fixed rail, collapsible) and mobile (Sheet overlay) automatically via `SidebarProvider` — no bespoke responsive code. The layout passes the authenticated user's email (from the existing `getAuthenticatedUser()` call) down to `AppSidebar`'s footer.

`AppSidebar` (`web/components/app-sidebar.tsx`) renders three sections in one flat list:
- **SidebarHeader** — `APP_NAME` ("Newsletter Generator") as the brand, plus the `ThemeToggle`.
- **SidebarContent** — a `SidebarMenu` with six `SidebarMenuItem` / `SidebarMenuButton` entries linking to the six routes, in this fixed order: Dashboard (`/`), Newsletters (`/newsletters`), Runs (`/runs`), Schedules (`/schedules`), Prompts (`/prompts`), Delivery (`/delivery`). Lucide icons on each (e.g. `LayoutDashboard`, `Newspaper`, `History`, `CalendarClock`, `ScrollText`, `Send`). Active state via `usePathname()` (Next.js Active Link pattern — `isActive` when `pathname === href`, or for Dashboard when `pathname === "/"`).
- **SidebarFooter** — the authenticated user's email (truncated with ellipsis if long) and the existing `LogoutButton`.

`ThemeToggle` (`web/components/theme-toggle.tsx`) is a client component using `next-themes`' `useTheme`: a shadcn `Button` (ghost, icon size) with a sun icon in light mode and a moon icon in dark mode (toggle on click). It guards against `mounted`/hydration mismatch (render a placeholder until mounted, the standard `next-themes` pattern), and persists the choice via `next-themes`' built-in `localStorage` storage (no custom storage code).

The login page (`web/app/login/page.tsx`) is restyled with shadcn `Card`/`Input`/`Button`/`Label` — centering a `Card` with `CardHeader`/`CardTitle` ("Log in") + `CardContent` form (email + password `Input`s with `Label`s) + the existing `loginAction` via `useActionState`, error alert styled with shadcn `Alert`/`AlertDescription`. The existing `loginAction`/`logoutAction` server actions and `mapLoginError` are unchanged.

The dashboard home (`web/app/(protected)/page.tsx`) renders a welcome heading (app name), one intro sentence ("Configure newsletters, run the pipeline, and deliver digests — all in one place."), and an empty `<section>` container (no fake card, no placeholder text inside it — feature 04 drops the DB health card in here). It removes the old `LogoutButton` from the page body (logout now lives in the sidebar footer).

Five placeholder pages, each a uniform "coming soon" stub: section heading + one line ("This area is under construction.") + nothing else:
- `web/app/(protected)/newsletters/page.tsx`
- `web/app/(protected)/runs/page.tsx`
- `web/app/(protected)/schedules/page.tsx`
- `web/app/(protected)/prompts/page.tsx`
- `web/app/(protected)/delivery/page.tsx`

The `/health` route and `/login` route remain untouched (still public per `web/lib/auth/routes.ts`).

## Dependencies

- Builds on: stage-00 feature-06 (auth gate — middleware, `(protected)` route group, `getAuthenticatedUser`, `loginAction`/`logoutAction` server actions, `LogoutButton` component).
- Builds on: stage-00 feature-02 (`getServerAppwrite`, `APP_NAME` from `@newsletter/shared` — used by the sidebar header and unchanged).
- Builds on: stage-00 feature-04 (Vitest + ESLint + Prettier + `pnpm typecheck` — provides the verification commands).
- Orphaned by: none — second feature in stage 02. Does NOT depend on feature-01 (schema provisioner); the dashboard's DB health card (feature 04) is what composes the provisioner with the GUI. This feature is pure shell/layout.

## Constraints

- **shadcn/ui + Tailwind v4 is the GUI contract pinned by this feature.** Later GUI stages (features 03, 04, and stages 03–09) use the components and theme established here; they do NOT introduce a second component library or an alternate styling approach. If a later stage needs a component this stage didn't baseline, it extends the shadcn set via the same CLI, not a one-off (per the stage's "Pins carried forward").
- **Flat nav, fixed order, fixed routes.** The six sections (Dashboard `/`, Newsletters `/newsletters`, Runs `/runs`, Schedules `/schedules`, Prompts `/prompts`, Delivery `/delivery`) and their order are binding on later stages. Later stages fill in placeholder pages; they do NOT rename routes, reorder the nav, or add top-level sections without a re-plan.
- **Theme: class-based, system-preference default, dark fallback.** `next-themes` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`. Explicit user choice (persisted by `next-themes` in `localStorage`) wins; otherwise system `prefers-color-scheme`; if neither resolves, dark. Later stages do not re-implement theming.
- **Auth gate is unchanged.** The existing middleware (`web/middleware.ts`), `getAuthenticatedUser` (`web/lib/auth/session.ts`), `loginAction`/`logoutAction` (`web/app/login/actions.ts`), `PUBLIC_ROUTES` (`web/lib/auth/routes.ts`), and the `(protected)` route group's redirect behavior are NOT modified by this feature. The shell renders inside the gate; it does not alter the gate.
- **No domain data, no DB access in this feature.** The dashboard's empty section is a container only; it does NOT read or write the `health_check` collection (that's feature 04). No new server actions, no API routes, no Appwrite calls beyond the existing `getAuthenticatedUser()` (which the protected layout already makes).
- **No changes to `shared/` or `worker/`.** This feature is entirely within `web/`. The schema provisioner (feature 01) and worker boot path are untouched.
- **No new dependencies beyond shadcn/ui's requirements.** Specifically: `tailwindcss` v4, `@tailwindcss/postcss` (the v4 PostCSS plugin), `next-themes`, `lucide-react`, `tailwindcss-animate`, plus the Radix primitives shadcn pulls in for the components this feature uses (`sidebar`, `sheet`, `button`, `card`, `input`, `label`, `alert`). All installed via the shadcn CLI / standard `pnpm add` — no vendored copies.
- **`web/app/health/route.ts` and `web/app/login/*` logic is preserved.** The `/health` route stays public and unchanged; the login page is restyled but its server action, error mapping, and redirect-after-success behavior are identical.

## Acceptance criteria

- [ ] `web/app/globals.css` exists with Tailwind v4 setup (`@import "tailwindcss"`, `@plugin "tailwindcss-animate"`, `@custom-variant dark`), full shadcn token set in `:root` and `.dark` (background, foreground, card, primary, accent, muted, border, ring + the sidebar-specific tokens), and `@theme inline` mapping so `bg-background` / `text-foreground` / `bg-sidebar` / `text-sidebar-foreground` resolve.
- [ ] `web/components.json` exists (shadcn config: `style: "new-york"`, `tsx: true`, `rsc: true`, `css: "app/globals.css"`, `baseColor: "neutral"`, `cssVariables: true`, `iconLibrary: "lucide"`).
- [ ] `web/components/theme-provider.tsx` exports a `ThemeProvider` wrapping `next-themes`' provider with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`.
- [ ] `web/app/layout.tsx` wraps `<body>` in `<ThemeProvider>` and sets `suppressHydrationWarning` on `<html>` (required by `next-themes`).
- [ ] `web/components/app-sidebar.tsx` renders `SidebarHeader` (app name + `ThemeToggle`), `SidebarContent` (six nav links in the fixed order with Lucide icons, active state via `usePathname()`), `SidebarFooter` (user email + `LogoutButton`).
- [ ] `web/components/theme-toggle.tsx` is a client component using `useTheme()` from `next-themes`, rendering a sun/moon toggle button, with a mounted guard against hydration mismatch.
- [ ] `web/app/(protected)/layout.tsx` renders `SidebarProvider` + `AppSidebar` + `<main>` with `SidebarTrigger` and `{children}`, and passes the authenticated user's email to `AppSidebar`.
- [ ] `web/app/(protected)/page.tsx` renders the dashboard: app name heading, intro sentence, and an empty `<section>` container (no fake card, no placeholder text inside).
- [ ] Five placeholder pages exist (`newsletters`, `runs`, `schedules`, `prompts`, `delivery` under `web/app/(protected)/`), each rendering the uniform "coming soon" stub (section heading + "This area is under construction.").
- [ ] `web/app/login/page.tsx` is restyled with shadcn `Card`/`Input`/`Label`/`Button`/`Alert`; the existing `loginAction`, `useActionState` wiring, error display, and redirect-after-success behavior are unchanged.
- [ ] `web/components/LogoutButton.tsx` uses shadcn `Button` (variant ghost, size sm, full-width) wrapped in the existing `<form action={logoutAction}>`.
- [ ] `pnpm --filter web build` exits zero.
- [ ] `pnpm typecheck` exits zero across `shared`, `web`, `worker`.
- [ ] `pnpm lint` exits zero.
- [ ] The six nav routes (`/`, `/newsletters`, `/runs`, `/schedules`, `/prompts`, `/delivery`) resolve without error behind auth; unauthenticated requests to any of them redirect to `/login` (inherited from the existing middleware — no new auth code).
- [ ] `/health` (public) and `/login` (public) still respond as before — no regression.
- [ ] Existing stage-00 tests still pass (`pnpm test` — `web/src/__tests__/routes.test.ts`, `web/src/__tests__/login-errors.test.ts`, and all `shared/` tests).
- [ ] **PM manual gate (see Feature verification):** the PM starts the app and confirms the shell works end-to-end by hand before the feature is marked verified.

## Files

- Create: `web/app/globals.css`
- Create: `web/components.json`
- Create: `web/components/theme-provider.tsx`
- Create: `web/components/theme-toggle.tsx`
- Create: `web/components/app-sidebar.tsx`
- Create: `web/components/ui/sidebar.tsx` (shadcn CLI-generated)
- Create: `web/components/ui/sheet.tsx` (shadcn CLI-generated)
- Create: `web/components/ui/button.tsx` (shadcn CLI-generated)
- Create: `web/components/ui/card.tsx` (shadcn CLI-generated)
- Create: `web/components/ui/input.tsx` (shadcn CLI-generated)
- Create: `web/components/ui/label.tsx` (shadcn CLI-generated)
- Create: `web/components/ui/alert.tsx` (shadcn CLI-generated)
- Create: `web/lib/utils.ts` (shadcn CLI-generated — `cn` helper)
- Create: `web/app/(protected)/newsletters/page.tsx`
- Create: `web/app/(protected)/runs/page.tsx`
- Create: `web/app/(protected)/schedules/page.tsx`
- Create: `web/app/(protected)/prompts/page.tsx`
- Create: `web/app/(protected)/delivery/page.tsx`
- Modify: `web/app/layout.tsx` (wrap body in `ThemeProvider`, set `suppressHydrationWarning`)
- Modify: `web/app/(protected)/layout.tsx` (render `SidebarProvider` + `AppSidebar` + `<main>` with `SidebarTrigger`; pass user email to sidebar)
- Modify: `web/app/(protected)/page.tsx` (dashboard home: heading + intro + empty container; remove inline `LogoutButton`)
- Modify: `web/app/login/page.tsx` (restyle with shadcn Card/Input/Label/Button/Alert)
- Modify: `web/components/LogoutButton.tsx` (use shadcn Button)
- Modify: `web/package.json` (add Tailwind v4, `@tailwindcss/postcss`, `next-themes`, `lucide-react`, `tailwindcss-animate`, Radix primitives — via shadcn CLI / `pnpm add`)
- Create: `web/postcss.config.mjs` (Tailwind v4 PostCSS plugin config)

## Testing approach

**Not test-first — this is a visual/layout feature**, the named exception in the SSC test-first rule ("a visual layout"). The behavior that could be unit-tested is shallow (asserting JSX equals itself, or re-testing the already-covered auth gate), so unit tests would add noise without meaningfully de-risking the feature. The meaningful verification is end-to-end: build, typecheck, lint, and route resolution prove the shell composes; the PM's manual gate proves it renders and behaves correctly in a browser.

What the automated verifier checks (per task and at feature verification):
- `pnpm --filter web build` exits zero — catches missing imports, broken JSX, invalid route modules, type errors in the build path.
- `pnpm typecheck` exits zero across `shared`, `web`, `worker` under strict mode — catches type drift in the new components and modified layouts.
- `pnpm lint` exits zero — catches unused imports, React hooks violations, accessibility lint (eslint-config-next includes a11y rules).
- Route resolution — each of the six nav routes returns 200 behind auth (no runtime error page); unauthenticated requests redirect to `/login` (inherited from the existing middleware — no new test, just confirmed by building against the unchanged middleware matcher).
- No regressions — `pnpm test` still passes (stage-00's `routes.test.ts` and `login-errors.test.ts` in `web/src/__tests__/`, plus all `shared/` tests).

What the PM manual gate checks (see Feature verification) — the human-in-the-loop confirmation that the running app actually works as seen by the operator, which no automated test can substitute for a visual feature.

## Tasks

### Task 1: Tailwind v4 + shadcn/ui init + theme foundation

- **Action:** In `web/`: install Tailwind v4 (`pnpm add tailwindcss@latest @tailwindcss/postcss tailwindcss-animate`) and create `web/postcss.config.mjs` exporting `{ plugins: { "@tailwindcss/postcss": {} } }`. Run `npx shadcn@latest init` with `--base radix --template next` (or the equivalent current-flag form; accept the neutral base color, new-york style, `app/globals.css` css path, CSS variables enabled, lucide icons) to produce `web/components.json`, `web/lib/utils.ts` (`cn`), and the `@/components/ui` / `@/hooks` alias resolution. Write `web/app/globals.css`: `@import "tailwindcss"`, `@plugin "tailwindcss-animate"`, `@custom-variant dark (&:is(.dark *))`, the full shadcn token set in `:root` and `.dark` (background, foreground, card, card-foreground, popover, popover-foreground, primary, primary-foreground, secondary, secondary-foreground, muted, muted-foreground, accent, accent-foreground, destructive, destructive-foreground, border, input, ring, plus the sidebar tokens: sidebar-background, sidebar-foreground, sidebar-primary, sidebar-primary-foreground, sidebar-accent, sidebar-accent-foreground, sidebar-border, sidebar-ring), and `@theme inline` mapping every `--color-*` to its `var(--*)`. Install `next-themes` (`pnpm add next-themes`). Create `web/components/theme-provider.tsx` exporting a `ThemeProvider` client component wrapping `next-themes`'s `NextThemesProvider` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`. Modify `web/app/layout.tsx` to wrap `<body>` in `<ThemeProvider>` and add `suppressHydrationWarning` to `<html>`.
- **Expected result:** Tailwind v4 + shadcn/ui are installed and configured; the theme provider is wired into the root layout; `globals.css` holds the full token set for light and dark.
- **Verify:** Run `pnpm --filter web build` — exits zero. Run `pnpm typecheck` — zero errors. Run `pnpm lint` — zero errors. Confirm `web/components.json`, `web/app/globals.css`, `web/postcss.config.mjs`, `web/components/theme-provider.tsx` exist and `web/app/layout.tsx` wraps body in `ThemeProvider`.
- **Depends on:** none.

### Task 2: shadcn components + AppSidebar + ThemeToggle

- **Action:** Run `npx shadcn@latest add sidebar sheet button card input label alert` (generates `web/components/ui/{sidebar,sheet,button,card,input,label,alert}.tsx` and installs their Radix dependencies via `pnpm`). Create `web/components/app-sidebar.tsx` — a client component using shadcn's `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarFooter`, and `usePathname` from `next/navigation`. Header: `APP_NAME` (import from `@newsletter/shared`) as brand + `<ThemeToggle />`. Content: six `SidebarMenuItem` entries in the fixed order (Dashboard `/` icon `LayoutDashboard`, Newsletters `/newsletters` icon `Newspaper`, Runs `/runs` icon `History`, Schedules `/schedules` icon `CalendarClock`, Prompts `/prompts` icon `ScrollText`, Delivery `/delivery` icon `Send`) — each a `SidebarMenuButton` with `asChild` wrapping a `<Link href={route}>`, `isActive` prop set from `usePathname()` (exact match; Dashboard active only on `/`). Footer: the authenticated user's email (passed as a prop from the protected layout, truncated with Tailwind's `truncate` if it overflows) + the existing `LogoutButton`. Accept `userEmail: string | null` as a prop. Create `web/components/theme-toggle.tsx` — a client component using `useTheme` from `next-themes`: a shadcn `Button` (variant `ghost`, size `icon`) toggling between a `Sun` icon (light) and `Moon` icon (dark), with the standard `mounted` guard (render a placeholder `Button` until mounted to avoid hydration mismatch).
- **Expected result:** The sidebar and theme toggle components exist, use shadcn primitives, and are ready to be wired into the protected layout.
- **Verify:** Run `pnpm --filter web build` — exits zero. Run `pnpm typecheck` — zero errors. Run `pnpm lint` — zero errors. Confirm `web/components/ui/{sidebar,sheet,button,card,input,label,alert}.tsx`, `web/components/app-sidebar.tsx`, `web/components/theme-toggle.tsx` exist.
- **Depends on:** Task 1.

### Task 3: Wire sidebar into protected layout + restyle login + LogoutButton

- **Action:** Modify `web/app/(protected)/layout.tsx`: keep the existing `getAuthenticatedUser()` call and redirect-when-null; wrap the returned JSX in `<SidebarProvider><AppSidebar userEmail={user?.email ?? null} /><main className="flex-1 p-4"><SidebarTrigger />{children}</main></SidebarProvider>` (import `SidebarProvider`, `SidebarTrigger` from `@/components/ui/sidebar`, `AppSidebar` from `@/components/app-sidebar`). Modify `web/app/login/page.tsx`: replace the raw `<form>` with a centered shadcn `Card` containing `CardHeader`/`CardTitle` ("Log in"), `CardContent` with the form (email + password `Input`s with `Label`s, the `loginAction` via `useActionState` unchanged), and an `Alert`/`AlertDescription` for `state?.error` (destructive variant). Keep the existing `useEffect` redirect-on-success and `useActionState` wiring. Modify `web/components/LogoutButton.tsx`: replace the raw `<button>` with shadcn `Button` (variant `ghost`, size `sm`, `w-full justify-start`), still wrapped in the existing `<form action={logoutAction}>`.
- **Expected result:** The protected layout renders the sidebar shell; the login page uses shadcn components; logout is a styled shadcn button in the sidebar footer.
- **Verify:** Run `pnpm --filter web build` — exits zero. Run `pnpm typecheck` — zero errors. Run `pnpm lint` — zero errors. Confirm `web/app/(protected)/layout.tsx` imports and renders `SidebarProvider`/`AppSidebar`/`SidebarTrigger` and passes `userEmail`; `web/app/login/page.tsx` uses `Card`/`Input`/`Label`/`Button`/`Alert`; `LogoutButton.tsx` uses shadcn `Button`.
- **Depends on:** Task 2.

### Task 4: Dashboard home + five placeholder pages

- **Action:** Replace `web/app/(protected)/page.tsx` with the dashboard: a `<h1>` with `APP_NAME`, a `<p>` with the intro sentence ("Configure newsletters, run the pipeline, and deliver digests — all in one place."), and an empty `<section aria-label="Dashboard widgets" className="mt-8" />` container (no children — feature 04 drops the DB health card in here). Remove the old inline `LogoutButton` import and usage (logout now lives in the sidebar footer). Create five page files under `web/app/(protected)/`: `newsletters/page.tsx`, `runs/page.tsx`, `schedules/page.tsx`, `prompts/page.tsx`, `delivery/page.tsx` — each a server component rendering a uniform "coming soon" stub: an `<h1>` with the section name (e.g. "Newsletters") and a `<p>` with "This area is under construction." Nothing else.
- **Expected result:** The dashboard home renders the welcome content with an empty container for feature 04; the five placeholder pages render uniform stubs; all six routes are reachable from the sidebar.
- **Verify:** Run `pnpm --filter web build` — exits zero. Run `pnpm typecheck` — zero errors. Run `pnpm lint` — zero errors. Run `pnpm test` — stage-00 tests still green (no regressions). Confirm all six `page.tsx` files exist under `web/app/(protected)/` and the dashboard page has no `LogoutButton` import.
- **Depends on:** Task 3.

## Feature verification

This feature uses a **two-stage gate**: automated verification first, then a PM manual gate.

### Stage A — Automated verifier

- Run: `pnpm install && pnpm --filter web build && pnpm typecheck && pnpm lint && pnpm test`
- Expected: Install resolves cleanly (Tailwind v4, shadcn dependencies, next-themes, lucide-react, Radix primitives). `next build` completes with zero errors and emits the static + dynamic routes for `/`, `/newsletters`, `/runs`, `/schedules`, `/prompts`, `/delivery`, `/login`, `/health`. `pnpm typecheck` passes with zero errors across `shared`, `web`, `worker` under strict mode. `pnpm lint` passes with zero errors (no unused imports, no hooks violations, a11y rules satisfied). `pnpm test` passes — stage-00's `web/src/__tests__/routes.test.ts` and `login-errors.test.ts` and all `shared/` tests still green (no regressions). The six nav routes are buildable (no `TypeError`/`Module not found` in the build output). `/health` and `/login` remain public per `web/lib/auth/routes.ts` (unchanged).

### Stage B — PM manual gate (manager-driven)

After Stage A passes, the `ssc-execute` manager **does not** mark the feature verified. Instead it asks the PM (the human) to start the app and confirm the following by hand. The feature is marked `verified` only after the PM confirms all of these:

1. **Auth gate still works:** Visit `http://localhost:3000/` unauthenticated — redirects to `/login`. Log in with valid credentials — redirects back to `/` (dashboard).
2. **Sidebar visible on desktop:** On a desktop-width window, the sidebar renders on the left with the app name ("Newsletter Generator") and theme toggle in the header, six nav links in the middle, and the user's email + Log out button in the footer.
3. **Mobile hamburger:** Narrow the window below the `md` breakpoint (or use browser devtools mobile view). The sidebar collapses; a hamburger icon (SidebarTrigger) appears; clicking it opens the sidebar as a Sheet overlay; clicking a nav link navigates and closes the overlay.
4. **All six routes render:** Click each nav link in turn. Dashboard shows the app name, intro sentence, and empty space. Newsletters, Runs, Schedules, Prompts, Delivery each show their section name heading + "This area is under construction." No error pages, no broken links, no console errors.
5. **Active link highlighting:** The nav link for the current route is visually marked as active (shadcn sidebar active style). Navigating between routes updates the active link.
6. **Theme toggle works:** Click the sun/moon toggle. The theme switches between light and dark. The choice persists across a full page reload (next-themes localStorage). Clearing localStorage and reloading falls back to system preference; if system preference is unavailable, falls back to dark.
7. **Logout works:** Click "Log out" in the sidebar footer. Redirects to `/login`. Attempting to navigate back to `/` redirects to `/login` (session cleared).
8. **Login page restyled:** The login page renders as a centered card with shadcn-styled inputs and button. Submitting with empty fields shows the "Email and password are required" error in the Alert. Submitting with wrong credentials shows the mapped error. Submitting with valid credentials logs in and redirects to `/`.
9. **`/health` unchanged:** `http://localhost:3000/health` returns the JSON health status as before (reachable without auth).

The manager records the PM's confirmations; on all-yes, it marks the feature `verified` and writes `last_verified`. On any "no," it records the failure reason and either retries the relevant task or escalates.

## Handoff

When complete, the builder reports to the manager:
- The list of files created and modified (everything under `web/` — `globals.css`, `components.json`, `postcss.config.mjs`, `theme-provider.tsx`, `theme-toggle.tsx`, `app-sidebar.tsx`, the `components/ui/*` shadcn primitives, `lib/utils.ts`, the five placeholder `page.tsx` files, and the modified `layout.tsx`/`(protected)/layout.tsx`/`(protected)/page.tsx`/`login/page.tsx`/`LogoutButton.tsx`/`package.json`).
- Confirmation that `pnpm --filter web build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass.
- The exact exported symbol names so feature 03 (shared component baseline) and later GUI stages import them consistently: `ThemeProvider` (from `@/components/theme-provider`), `AppSidebar` (from `@/components/app-sidebar`, takes `userEmail: string | null` prop), `ThemeToggle` (from `@/components/theme-toggle`), and the shadcn primitives under `@/components/ui/`.
- The exact nav routes and order pinned by this feature (`/`, `/newsletters`, `/runs`, `/schedules`, `/prompts`, `/delivery`) so later stages know which placeholder page to fill in.
- The theme config pinned (`attribute="class"`, `defaultTheme="system"`, `enableSystem`, dark fallback) so later stages do not re-implement theming.
- Confirmation that the auth gate (`middleware.ts`, `session.ts`, `login/actions.ts`, `routes.ts`) was NOT modified.
- Confirmation that no changes were made to `shared/` or `worker/`.
- Any deviation from this spec and the reason (e.g. a shadcn CLI flag that differs from the spec's pseudocode, a Tailwind v4 API change, a Radix primitive version quirk, a `next-themes` API difference).
- The PM manual gate questions (from Feature verification Stage B) surfaced to the manager so it knows to run them before marking verified.