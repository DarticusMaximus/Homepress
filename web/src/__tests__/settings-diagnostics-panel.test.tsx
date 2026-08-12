/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SettingsPanelData } from "@/lib/settings-panel";
import { ConnectionsSettings } from "@/components/settings/connections-settings";

const mocks = vi.hoisted(() => ({
  saveConnectionsSettingsAction: vi.fn(),
  clearOpenRouterOverrideAction: vi.fn(),
  clearSmtpOverrideAction: vi.fn(),
  testOpenRouterConnectionAction: vi.fn(),
  testSmtpConnectionAction: vi.fn(),
  checkPublicUrlAction: vi.fn(),
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

vi.mock("@/app/(protected)/settings/actions", () => ({
  saveConnectionsSettingsAction: mocks.saveConnectionsSettingsAction,
  savePipelineKnobsSettingsAction: vi.fn(),
  clearOpenRouterOverrideAction: mocks.clearOpenRouterOverrideAction,
  clearSmtpOverrideAction: mocks.clearSmtpOverrideAction,
  testOpenRouterConnectionAction: mocks.testOpenRouterConnectionAction,
  testSmtpConnectionAction: mocks.testSmtpConnectionAction,
  checkPublicUrlAction: mocks.checkPublicUrlAction,
}));

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
}));

const PANEL_FIXTURE: SettingsPanelData = {
  openRouterApiKeySet: true,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUsername: "ops@example.com",
  smtpPasswordSet: true,
  smtpFrom: "news@example.com",
  smtpSecure: "true",
  appPublicUrl: "https://app.example.com",
  scoreThreshold: 5,
  crossRunSimilarityThreshold: 0.85,
  rssFeedMaxItems: 20,
  drafterReasoningEffort: "medium",
  drafterMaxCompletionTokens: 4096,
  resolved: {
    openRouterApiKey: { source: "gui" },
    smtp: {
      source: "gui",
      host: "smtp.example.com",
      port: 587,
      username: "ops@example.com",
      from: "news@example.com",
      secure: true,
    },
    appPublicUrl: { value: "https://app.example.com", source: "gui" },
    scoreThreshold: { value: 5, source: "gui" },
    crossRunSimilarityThreshold: { value: 0.85, source: "gui" },
    rssFeedMaxItems: { value: 20, source: "gui" },
    drafterReasoningEffort: { value: "medium", source: "gui" },
    drafterMaxCompletionTokens: { value: 4096, source: "gui" },
  },
};

afterEach(() => {
  cleanup();
  mocks.saveConnectionsSettingsAction.mockReset();
  mocks.clearOpenRouterOverrideAction.mockReset();
  mocks.clearSmtpOverrideAction.mockReset();
  mocks.testOpenRouterConnectionAction.mockReset();
  mocks.testSmtpConnectionAction.mockReset();
  mocks.checkPublicUrlAction.mockReset();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

describe("ConnectionsSettings — connection diagnostics controls", () => {
  it("renders three separate Test/Check controls", () => {
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    expect(screen.getByRole("button", { name: /test openrouter/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /test smtp/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check public url/i })).toBeInTheDocument();
  });

  it("shows saved-settings helper copy near the Test controls", () => {
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    expect(
      screen.getByText(/saved settings/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/save connections first/i),
    ).toBeInTheDocument();
  });

  it("has no SMTP recipient field or dialog for diagnostics", () => {
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    expect(screen.queryByLabelText(/recipient/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/recipient/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows Testing… pending label while OpenRouter test is in flight", async () => {
    let resolveTest!: (v: { status: "pass"; message: string }) => void;
    mocks.testOpenRouterConnectionAction.mockImplementation(
      () =>
        new Promise((r) => {
          resolveTest = r;
        }),
    );
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    const button = screen.getByRole("button", { name: /test openrouter/i });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.getByRole("button", { name: /testing/i })).toBeInTheDocument();

    await act(async () => {
      resolveTest({ status: "pass", message: "OpenRouter key is valid" });
    });
  });

  it("shows Checking… pending label while public URL check is in flight", async () => {
    let resolveCheck!: (v: { status: "pass"; message: string }) => void;
    mocks.checkPublicUrlAction.mockImplementation(
      () =>
        new Promise((r) => {
          resolveCheck = r;
        }),
    );
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /check public url/i }));
    });

    expect(screen.getByRole("button", { name: /checking/i })).toBeInTheDocument();

    await act(async () => {
      resolveCheck({ status: "pass", message: "Public URL is reachable" });
    });
  });

  it("toasts success on pass and shows inline Pass status", async () => {
    mocks.testOpenRouterConnectionAction.mockResolvedValue({
      status: "pass",
      message: "OpenRouter key is valid",
    });
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    fireEvent.click(screen.getByRole("button", { name: /test openrouter/i }));

    await waitFor(() => {
      expect(mocks.toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/OpenRouter key is valid/i),
      );
    });
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText(/OpenRouter key is valid/i)).toBeInTheDocument();
  });

  it("toasts error on fail and shows inline Fail status", async () => {
    mocks.testSmtpConnectionAction.mockResolvedValue({
      status: "fail",
      message: "SMTP is not configured",
    });
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    fireEvent.click(screen.getByRole("button", { name: /test smtp/i }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith("SMTP is not configured");
    });
    expect(screen.getByText(/fail/i)).toBeInTheDocument();
    expect(screen.getByText(/SMTP is not configured/i)).toBeInTheDocument();
  });

  it("toasts warning on warn and shows inline Warn status", async () => {
    mocks.checkPublicUrlAction.mockResolvedValue({
      status: "warn",
      message:
        "Homepress could not reach https://app.example.com from this server; browsers and RSS clients may still work.",
    });
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    fireEvent.click(screen.getByRole("button", { name: /check public url/i }));

    await waitFor(() => {
      expect(mocks.toast.warning).toHaveBeenCalledWith(
        expect.stringMatching(/could not reach/i),
      );
    });
    expect(screen.getByText(/warn/i)).toBeInTheDocument();
    expect(screen.getByText(/could not reach/i)).toBeInTheDocument();
  });
});
