/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SettingsPanelData } from "@/lib/settings-panel";
import { ConnectionsSettings } from "@/components/settings/connections-settings";
import { PipelineKnobsSettings } from "@/components/settings/pipeline-knobs-settings";
import { SettingsSourceLabel } from "@/components/settings/settings-source-label";

const mocks = vi.hoisted(() => ({
  saveConnectionsSettingsAction: vi.fn(),
  savePipelineKnobsSettingsAction: vi.fn(),
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

vi.mock("@/app/(protected)/admin/settings/actions", () => ({
  saveConnectionsSettingsAction: mocks.saveConnectionsSettingsAction,
  savePipelineKnobsSettingsAction: mocks.savePipelineKnobsSettingsAction,
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
  mocks.savePipelineKnobsSettingsAction.mockReset();
  mocks.clearOpenRouterOverrideAction.mockReset();
  mocks.clearSmtpOverrideAction.mockReset();
  mocks.testOpenRouterConnectionAction.mockReset();
  mocks.testSmtpConnectionAction.mockReset();
  mocks.checkPublicUrlAction.mockReset();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

describe("SettingsSourceLabel — cascade labels", () => {
  it.each([
    ["gui", "GUI override"],
    ["env", "from .env"],
    ["default", "built-in default"],
    ["none", "not set"],
  ] as const)("source %s → %s", (source, label) => {
    render(<SettingsSourceLabel source={source} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("ConnectionsSettings — secret status and Clear", () => {
  it("shows secret status without values (set via GUI / from .env / not set)", () => {
    const { rerender } = render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    expect(screen.getAllByText(/set via GUI/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("sk-or-");
    expect(document.body.textContent).not.toContain("stored-smtp");

    rerender(
      <ConnectionsSettings
        data={{
          ...PANEL_FIXTURE,
          openRouterApiKeySet: false,
          smtpPasswordSet: false,
          resolved: {
            ...PANEL_FIXTURE.resolved,
            openRouterApiKey: { source: "env" },
            smtp: { ...PANEL_FIXTURE.resolved.smtp, source: "env" },
          },
        }}
      />,
    );
    expect(screen.getAllByText(/from \.env/i).length).toBeGreaterThan(0);

    rerender(
      <ConnectionsSettings
        data={{
          ...PANEL_FIXTURE,
          openRouterApiKeySet: false,
          smtpPasswordSet: false,
          smtpHost: "",
          smtpPort: null,
          smtpUsername: "",
          smtpFrom: "",
          smtpSecure: "",
          resolved: {
            ...PANEL_FIXTURE.resolved,
            openRouterApiKey: { source: "none" },
            smtp: {
              source: "none",
              host: null,
              port: null,
              username: null,
              from: null,
              secure: null,
            },
          },
        }}
      />,
    );
    expect(screen.getAllByText(/not set/i).length).toBeGreaterThan(0);
  });

  it("masked secret inputs start empty and Clear OpenRouter invokes immediate clear action", async () => {
    mocks.clearOpenRouterOverrideAction.mockResolvedValue({ ok: true });
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    const keyInput = screen.getByLabelText(/openrouter/i);
    expect(keyInput).toHaveAttribute("type", "password");
    expect(keyInput).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: /clear.*openrouter/i }));

    await waitFor(() => {
      expect(mocks.clearOpenRouterOverrideAction).toHaveBeenCalledTimes(1);
    });
    expect(mocks.saveConnectionsSettingsAction).not.toHaveBeenCalled();
  });

  it("Clear SMTP invokes immediate clear-all path (not empty→keep save)", async () => {
    mocks.clearSmtpOverrideAction.mockResolvedValue({ ok: true });
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    fireEvent.click(screen.getByRole("button", { name: /clear.*smtp/i }));

    await waitFor(() => {
      expect(mocks.clearSmtpOverrideAction).toHaveBeenCalledTimes(1);
    });
    expect(mocks.saveConnectionsSettingsAction).not.toHaveBeenCalled();
  });

  it("validation failure toasts the action error message", async () => {
    mocks.saveConnectionsSettingsAction.mockResolvedValue({
      ok: false,
      error: "SMTP settings must be a complete host/port/username/password set, or all cleared",
    });
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "SMTP settings must be a complete host/port/username/password set, or all cleared",
      );
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});

describe("PipelineKnobsSettings — cascade + zero", () => {
  it("shows pinned cascade labels for knobs from resolved sources", () => {
    render(
      <PipelineKnobsSettings
        data={{
          ...PANEL_FIXTURE,
          scoreThreshold: null,
          crossRunSimilarityThreshold: null,
          resolved: {
            ...PANEL_FIXTURE.resolved,
            scoreThreshold: { value: 7, source: "default" },
            crossRunSimilarityThreshold: { value: 0.85, source: "env" },
            rssFeedMaxItems: { value: 10, source: "gui" },
          },
        }}
      />,
    );

    expect(screen.getAllByText("built-in default").length).toBeGreaterThan(0);
    expect(screen.getAllByText("from .env").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GUI override").length).toBeGreaterThan(0);
  });

  it("saving score threshold 0 calls action with 0 and toasts success", async () => {
    mocks.savePipelineKnobsSettingsAction.mockResolvedValue({ ok: true });
    render(
      <PipelineKnobsSettings
        data={{
          ...PANEL_FIXTURE,
          scoreThreshold: null,
          crossRunSimilarityThreshold: null,
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText(/score threshold/i), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText(/cross-run similarity/i), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mocks.savePipelineKnobsSettingsAction).toHaveBeenCalledWith(
        expect.objectContaining({
          scoreThreshold: 0,
          crossRunSimilarityThreshold: 0,
        }),
      );
    });
    expect(mocks.toast.success).toHaveBeenCalled();
  });

  it("invalid score threshold blocks Save (no null-clear) and toasts error", async () => {
    mocks.savePipelineKnobsSettingsAction.mockResolvedValue({ ok: true });
    render(<PipelineKnobsSettings data={PANEL_FIXTURE} />);

    fireEvent.change(screen.getByLabelText(/score threshold/i), {
      target: { value: "not-a-number" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalled();
    });
    expect(mocks.savePipelineKnobsSettingsAction).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    const errorMsg = String(mocks.toast.error.mock.calls[0]?.[0] ?? "");
    expect(errorMsg.length).toBeGreaterThan(0);
    expect(errorMsg.toLowerCase()).toMatch(/score|number|invalid|numeric/);
  });

  it("blank score threshold clears via null without treating as invalid", async () => {
    mocks.savePipelineKnobsSettingsAction.mockResolvedValue({ ok: true });
    render(<PipelineKnobsSettings data={PANEL_FIXTURE} />);

    fireEvent.change(screen.getByLabelText(/score threshold/i), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mocks.savePipelineKnobsSettingsAction).toHaveBeenCalledWith(
        expect.objectContaining({
          scoreThreshold: null,
        }),
      );
    });
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalled();
  });
});

describe("Settings panel — diagnostics placement", () => {
  it("Connections section exposes the three diagnostic Test/Check controls", () => {
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    expect(screen.getByRole("button", { name: /test openrouter/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /test smtp/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check public url/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /diagnose/i })).not.toBeInTheDocument();
  });

  it("Pipeline knobs section has no Test / Diagnose controls", () => {
    render(<PipelineKnobsSettings data={PANEL_FIXTURE} />);

    expect(screen.queryByRole("button", { name: /test/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /diagnose/i })).not.toBeInTheDocument();
  });
});
