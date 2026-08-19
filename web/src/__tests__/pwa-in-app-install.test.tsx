/// <reference types="@testing-library/jest-dom" />

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
}));

const webRoot = path.resolve(__dirname, "../..");
const providerPath = path.join(webRoot, "components", "pwa-install-provider.tsx");
const homeScreenPath = path.join(webRoot, "components", "settings", "home-screen-settings.tsx");
const layoutPath = path.join(webRoot, "app", "layout.tsx");
const settingsPagePath = path.join(
  webRoot,
  "app",
  "(protected)",
  "admin",
  "settings",
  "page.tsx",
);

const PROMPT_ERROR_COPY =
  "Couldn't open the install dialog. Try Install app in the browser menu.";

type PromptOutcome = { outcome: "accepted" | "dismissed" };

type LoadedModules = {
  PwaInstallProvider: ComponentType<{ children: ReactNode }>;
  HomeScreenSettings: ComponentType;
};

/**
 * File URL + @vite-ignore: Vite must not fail the whole suite at transform time
 * while the provider/section are still missing (Task 1 red). existsSync assertions
 * surface the missing wiring as clear TDD failures.
 */
async function loadModules(): Promise<LoadedModules> {
  expect(existsSync(providerPath), `missing PwaInstallProvider: ${providerPath}`).toBe(true);
  expect(existsSync(homeScreenPath), `missing HomeScreenSettings: ${homeScreenPath}`).toBe(true);

  const providerMod = (await import(
    /* @vite-ignore */ pathToFileURL(providerPath).href
  )) as {
    PwaInstallProvider: ComponentType<{ children: ReactNode }>;
  };
  const homeMod = (await import(/* @vite-ignore */ pathToFileURL(homeScreenPath).href)) as {
    HomeScreenSettings: ComponentType;
  };

  return {
    PwaInstallProvider: providerMod.PwaInstallProvider,
    HomeScreenSettings: homeMod.HomeScreenSettings,
  };
}

function stubMatchMedia(opts: { standalone?: boolean; fullscreen?: boolean } = {}) {
  const standalone = opts.standalone ?? false;
  const fullscreen = opts.fullscreen ?? false;

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches:
        (query.includes("display-mode: standalone") && standalone) ||
        (query.includes("display-mode: fullscreen") && fullscreen),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function makeBeforeInstallPromptEvent(promptFn: ReturnType<typeof vi.fn>) {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: () => Promise<PromptOutcome>;
  };
  Object.defineProperty(event, "prompt", {
    value: promptFn,
    configurable: true,
  });
  return event;
}

async function dispatchBeforeInstallPrompt(
  promptFn: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ outcome: "accepted" }),
) {
  const event = makeBeforeInstallPromptEvent(promptFn);
  const preventDefault = vi.spyOn(event, "preventDefault");
  window.dispatchEvent(event);
  return { event, promptFn, preventDefault };
}

/**
 * Dual-render T1/T2 lock: a browser-mode control tree waitFor-getByTestId after
 * the same BIP (the reveal window), then assert the display-mode tree is still
 * absent. waitFor on queryByTestId-null is a no-op — Home screen starts absent.
 */
async function waitForBipRevealThenAssertDisplayModeAbsent(opts: {
  standalone: boolean;
  fullscreen: boolean;
}) {
  const { PwaInstallProvider, HomeScreenSettings } = await loadModules();

  const control = render(
    <PwaInstallProvider>
      <HomeScreenSettings />
    </PwaInstallProvider>,
  );

  stubMatchMedia(opts);
  const display = render(
    <PwaInstallProvider>
      <HomeScreenSettings />
    </PwaInstallProvider>,
  );

  await dispatchBeforeInstallPrompt();

  await waitFor(() => {
    expect(within(control.container).getByTestId("home-screen-settings")).toBeInTheDocument();
  });

  expect(within(display.container).queryByTestId("home-screen-settings")).not.toBeInTheDocument();
  expect(
    within(display.container).queryByRole("button", { name: "Install Homepress" }),
  ).not.toBeInTheDocument();
}

beforeEach(() => {
  stubMatchMedia({ standalone: false, fullscreen: false });
});

afterEach(() => {
  cleanup();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

describe("PWA in-app install — source wiring", () => {
  it("mounts PwaInstallProvider from root layout source wrapping children inside ThemeProvider", () => {
    // Source-read only — importing layout.tsx pulls globals.css / Tailwind and blows the harness.
    expect(existsSync(layoutPath), `missing root layout: ${layoutPath}`).toBe(true);
    const layoutSource = readFileSync(layoutPath, "utf8");

    expect(layoutSource).toMatch(/PwaInstallProvider/);
    expect(layoutSource).toMatch(/from\s+["'][^"']*pwa-install-provider["']/);
    expect(layoutSource).toMatch(
      /<ThemeProvider[\s\S]*?<PwaInstallProvider>[\s\S]*?\{children\}[\s\S]*?<\/PwaInstallProvider>[\s\S]*?<\/ThemeProvider>/,
    );
  });

  it("renders HomeScreenSettings on the settings page outside the load-success gate", () => {
    expect(existsSync(settingsPagePath), `missing settings page: ${settingsPagePath}`).toBe(true);
    const pageSource = readFileSync(settingsPagePath, "utf8");

    expect(pageSource).toMatch(/HomeScreenSettings/);
    expect(pageSource).toMatch(/from\s+["'][^"']*home-screen-settings["']/);
    expect(pageSource).toMatch(/<HomeScreenSettings\s*\/?>/);

    const gated = pageSource.match(/\{!loadError && data && \(([\s\S]*?)\)\n\s*\}/);
    expect(gated, "expected {!loadError && data && (...)} gate in settings page").toBeTruthy();
    expect(gated![1]).not.toMatch(/HomeScreenSettings/);
  });
});

describe("PWA in-app install — provider + Home screen section", () => {
  it("hides Home screen by default (no deferred BIP)", async () => {
    const { PwaInstallProvider, HomeScreenSettings } = await loadModules();

    render(
      <PwaInstallProvider>
        <HomeScreenSettings />
      </PwaInstallProvider>,
    );

    expect(screen.queryByTestId("home-screen-settings")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install Homepress" })).not.toBeInTheDocument();
  });

  it("reveals Home screen after beforeinstallprompt (preventDefault + helper + Install)", async () => {
    const { PwaInstallProvider, HomeScreenSettings } = await loadModules();

    render(
      <PwaInstallProvider>
        <HomeScreenSettings />
      </PwaInstallProvider>,
    );

    const { preventDefault } = await dispatchBeforeInstallPrompt();

    expect(preventDefault).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId("home-screen-settings")).toBeInTheDocument();
    });
    expect(screen.getByText("Add Homepress to this device as an app.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install Homepress" })).toBeInTheDocument();
  });

  it.each([{ outcome: "accepted" as const }, { outcome: "dismissed" as const }])(
    "tap Install Homepress calls prompt and hides for outcome=$outcome",
    async ({ outcome }) => {
      const { PwaInstallProvider, HomeScreenSettings } = await loadModules();
      const promptFn = vi.fn().mockResolvedValue({ outcome });

      render(
        <PwaInstallProvider>
          <HomeScreenSettings />
        </PwaInstallProvider>,
      );

      await dispatchBeforeInstallPrompt(promptFn);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Install Homepress" })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "Install Homepress" }));

      await waitFor(() => {
        expect(promptFn).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId("home-screen-settings")).not.toBeInTheDocument();
      });
    },
  );

  it("toast.error on prompt throw and clears the section", async () => {
    const { PwaInstallProvider, HomeScreenSettings } = await loadModules();
    const promptFn = vi.fn().mockRejectedValue(new Error("prompt failed"));

    render(
      <PwaInstallProvider>
        <HomeScreenSettings />
      </PwaInstallProvider>,
    );

    await dispatchBeforeInstallPrompt(promptFn);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Install Homepress" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Install Homepress" }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(PROMPT_ERROR_COPY);
      expect(screen.queryByTestId("home-screen-settings")).not.toBeInTheDocument();
    });
  });

  it("hides Home screen on appinstalled", async () => {
    const { PwaInstallProvider, HomeScreenSettings } = await loadModules();

    render(
      <PwaInstallProvider>
        <HomeScreenSettings />
      </PwaInstallProvider>,
    );

    await dispatchBeforeInstallPrompt();
    await waitFor(() => {
      expect(screen.getByTestId("home-screen-settings")).toBeInTheDocument();
    });

    window.dispatchEvent(new Event("appinstalled"));

    await waitFor(() => {
      expect(screen.queryByTestId("home-screen-settings")).not.toBeInTheDocument();
    });
  });

  it("standalone display-mode suppresses BIP (section stays absent)", async () => {
    await waitForBipRevealThenAssertDisplayModeAbsent({
      standalone: true,
      fullscreen: false,
    });
  });

  it("fullscreen display-mode suppresses BIP (section stays absent)", async () => {
    await waitForBipRevealThenAssertDisplayModeAbsent({
      standalone: false,
      fullscreen: true,
    });
  });

  it("HomeScreenSettings requires PwaInstallProvider (hook throws outside)", async () => {
    const { HomeScreenSettings } = await loadModules();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<HomeScreenSettings />)).toThrow();

    consoleError.mockRestore();
  });
});
