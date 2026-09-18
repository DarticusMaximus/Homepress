/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AppSettings, ResolvedOperatorSettings, SettingsSecretsHealth } from "@newsletter/shared";
import { toSettingsPanelData, type SettingsPanelData } from "@/lib/settings-panel";
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

const STORED_SECRET_KEY = "sk-or-stored-secret-value";
const STORED_SMTP_PASSWORD = "stored-smtp-password-value";

const HEALTHY_SECRETS_HEALTH: SettingsSecretsHealth = {
  cipher: "on",
  storedSecretCount: 2,
  unreadableSecretCount: 0,
};

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
  secretsHealth: HEALTHY_SECRETS_HEALTH,
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

const BASE_SETTINGS: AppSettings = {
  runRetentionDays: 30,
  updatedAt: "2026-08-11T12:00:00.000Z",
  taggerModel: "",
  scorerModel: "",
  drafterModel: "",
  embedderModel: "",
  titleDekModel: "",
  openRouterApiKey: STORED_SECRET_KEY,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUsername: "ops@example.com",
  smtpPassword: STORED_SMTP_PASSWORD,
  smtpFrom: "news@example.com",
  smtpSecure: "true",
  appPublicUrl: "https://app.example.com",
  scoreThreshold: 5,
  crossRunSimilarityThreshold: 0.85,
  rssFeedMaxItems: 20,
  drafterReasoningEffort: "medium",
  drafterMaxCompletionTokens: 4096,
};

const GUI_RESOLVED: ResolvedOperatorSettings = {
  openRouterApiKey: { value: STORED_SECRET_KEY, source: "gui" },
  smtp: {
    value: {
      host: "smtp.example.com",
      port: 587,
      username: "ops@example.com",
      password: STORED_SMTP_PASSWORD,
      from: "news@example.com",
      secure: true,
    },
    source: "gui",
  },
  appPublicUrl: { value: "https://app.example.com", source: "gui" },
  scoreThreshold: { value: 5, source: "gui" },
  crossRunSimilarityThreshold: { value: 0.85, source: "gui" },
  rssFeedMaxItems: { value: 20, source: "gui" },
  drafterReasoningEffort: { value: "medium", source: "gui" },
  drafterMaxCompletionTokens: { value: 4096, source: "gui" },
};

describe("toSettingsPanelData — secret strip + secretsHealth", () => {
  it("never includes openRouterApiKey or smtpPassword string values; booleans reflect GUI presence", () => {
    const dto = toSettingsPanelData(BASE_SETTINGS, GUI_RESOLVED, HEALTHY_SECRETS_HEALTH);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain(STORED_SECRET_KEY);
    expect(serialized).not.toContain(STORED_SMTP_PASSWORD);
    expect(dto).not.toHaveProperty("openRouterApiKey");
    expect(dto).not.toHaveProperty("smtpPassword");
    expect(dto.openRouterApiKeySet).toBe(true);
    expect(dto.smtpPasswordSet).toBe(true);
    expect(dto.resolved.openRouterApiKey).toEqual({ source: "gui" });
    expect(dto.resolved.openRouterApiKey).not.toHaveProperty("value");
    expect(dto.resolved.smtp).not.toHaveProperty("password");
    expect(dto.resolved.smtp.source).toBe("gui");
    expect(dto.secretsHealth).toEqual(HEALTHY_SECRETS_HEALTH);
  });

  it("maps secretsHealth through without copying stored secrets", () => {
    const health: SettingsSecretsHealth = {
      cipher: "off",
      storedSecretCount: 2,
      unreadableSecretCount: 1,
    };
    const dto = toSettingsPanelData(BASE_SETTINGS, GUI_RESOLVED, health);
    const serialized = JSON.stringify(dto);

    expect(dto.secretsHealth).toEqual(health);
    expect(serialized).not.toContain(STORED_SECRET_KEY);
    expect(serialized).not.toContain(STORED_SMTP_PASSWORD);
    expect(dto).not.toHaveProperty("openRouterApiKey");
    expect(dto).not.toHaveProperty("smtpPassword");
  });

  it("marks secrets unset when GUI overrides are empty", () => {
    const unset: AppSettings = {
      ...BASE_SETTINGS,
      openRouterApiKey: "",
      smtpPassword: "",
      smtpHost: "",
      smtpPort: null,
      smtpUsername: "",
      smtpFrom: "",
      smtpSecure: "",
    };
    const resolved: ResolvedOperatorSettings = {
      openRouterApiKey: { value: null, source: "none" },
      smtp: { value: null, source: "none" },
      appPublicUrl: { value: null, source: "none" },
      scoreThreshold: { value: 7, source: "default" },
      crossRunSimilarityThreshold: { value: 0.85, source: "default" },
      rssFeedMaxItems: { value: 10, source: "default" },
      drafterReasoningEffort: { value: "medium", source: "default" },
      drafterMaxCompletionTokens: { value: 8192, source: "default" },
    };
    const health: SettingsSecretsHealth = {
      cipher: "off",
      storedSecretCount: 0,
      unreadableSecretCount: 0,
    };

    const dto = toSettingsPanelData(unset, resolved, health);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain(STORED_SECRET_KEY);
    expect(serialized).not.toContain(STORED_SMTP_PASSWORD);
    expect(dto).not.toHaveProperty("openRouterApiKey");
    expect(dto).not.toHaveProperty("smtpPassword");
    expect(dto.openRouterApiKeySet).toBe(false);
    expect(dto.smtpPasswordSet).toBe(false);
    expect(dto.resolved.openRouterApiKey).not.toHaveProperty("value");
    expect(dto.resolved.smtp).not.toHaveProperty("password");
    expect(dto.secretsHealth).toEqual(health);
  });
});

function panelWithHealth(secretsHealth: SettingsSecretsHealth): SettingsPanelData {
  return { ...PANEL_FIXTURE, secretsHealth };
}

describe("ConnectionsSettings — secretsHealth banners", () => {
  it("cipher off with stored secrets shows the unencrypted warning, not a destructive alert", () => {
    render(
      <ConnectionsSettings
        data={panelWithHealth({
          cipher: "off",
          storedSecretCount: 1,
          unreadableSecretCount: 0,
        })}
      />,
    );

    const banner = screen.getByTestId("secrets-health-unencrypted");
    expect(banner).toHaveTextContent(/unencrypted/i);
    expect(banner).toHaveTextContent("SETTINGS_SECRET_KEY");
    expect(banner).not.toHaveClass("text-destructive");
    expect(screen.queryByTestId("secrets-health-invalid-key")).not.toBeInTheDocument();
    expect(screen.queryByTestId("secrets-health-unreadable")).not.toBeInTheDocument();
  });

  it("cipher off with no stored secrets does not show the unencrypted warning", () => {
    render(
      <ConnectionsSettings
        data={panelWithHealth({
          cipher: "off",
          storedSecretCount: 0,
          unreadableSecretCount: 0,
        })}
      />,
    );

    expect(screen.queryByTestId("secrets-health-unencrypted")).not.toBeInTheDocument();
    expect(screen.queryByTestId("secrets-health-invalid-key")).not.toBeInTheDocument();
    expect(screen.queryByTestId("secrets-health-unreadable")).not.toBeInTheDocument();
  });

  it("cipher invalid shows a destructive alert that secret saves are refused until the key is fixed", () => {
    render(
      <ConnectionsSettings
        data={panelWithHealth({
          cipher: "invalid",
          storedSecretCount: 0,
          unreadableSecretCount: 0,
        })}
      />,
    );

    const banner = screen.getByTestId("secrets-health-invalid-key");
    expect(banner).toHaveTextContent(/SETTINGS_SECRET_KEY/);
    expect(banner).toHaveTextContent(/refused/i);
    expect(banner).toHaveClass("text-destructive");
    expect(screen.queryByTestId("secrets-health-unencrypted")).not.toBeInTheDocument();
  });

  it("unreadable secrets show a destructive alert to re-enter secrets (env fallback)", () => {
    render(
      <ConnectionsSettings
        data={panelWithHealth({
          cipher: "on",
          storedSecretCount: 2,
          unreadableSecretCount: 1,
        })}
      />,
    );

    const banner = screen.getByTestId("secrets-health-unreadable");
    expect(banner).toHaveTextContent(/can'?t be decrypted/i);
    expect(banner).toHaveTextContent(/re-enter/i);
    expect(banner).toHaveTextContent(/env/i);
    expect(banner).toHaveClass("text-destructive");
    expect(screen.queryByTestId("secrets-health-unencrypted")).not.toBeInTheDocument();
    expect(screen.queryByTestId("secrets-health-invalid-key")).not.toBeInTheDocument();
  });

  it("healthy cipher on with readable stored secrets shows no banner", () => {
    render(<ConnectionsSettings data={PANEL_FIXTURE} />);

    expect(screen.queryByTestId("secrets-health-unencrypted")).not.toBeInTheDocument();
    expect(screen.queryByTestId("secrets-health-invalid-key")).not.toBeInTheDocument();
    expect(screen.queryByTestId("secrets-health-unreadable")).not.toBeInTheDocument();
  });
});

