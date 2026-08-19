/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DEFAULT_MODELS } from "@newsletter/shared/client";
import { GlobalModelDefaults } from "@/components/prompts/global-model-defaults";

const mocks = vi.hoisted(() => ({
  updateGlobalModelDefaultsAction: vi.fn(),
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

vi.mock("@/app/(protected)/admin/prompts/actions", () => ({
  updateGlobalModelDefaultsAction: mocks.updateGlobalModelDefaultsAction,
}));

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
}));

const FIXTURE = {
  taggerModel: "provider/tagger-model",
  scorerModel: "provider/scorer-model",
  drafterModel: "provider/drafter-model",
  embedderModel: "provider/embedder-model",
};

function renderDefaults(
  props: Partial<{
    taggerModel: string;
    scorerModel: string;
    drafterModel: string;
    embedderModel: string;
  }> = {},
) {
  return render(
    <GlobalModelDefaults
      taggerModel={props.taggerModel ?? FIXTURE.taggerModel}
      scorerModel={props.scorerModel ?? FIXTURE.scorerModel}
      drafterModel={props.drafterModel ?? FIXTURE.drafterModel}
      embedderModel={props.embedderModel ?? FIXTURE.embedderModel}
    />,
  );
}

afterEach(() => {
  cleanup();
  mocks.updateGlobalModelDefaultsAction.mockReset();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

describe("GlobalModelDefaults", () => {
  it("renders four labeled inputs initialized from props", () => {
    renderDefaults();

    expect(screen.getByLabelText("Tagger")).toHaveValue(FIXTURE.taggerModel);
    expect(screen.getByLabelText("Scorer")).toHaveValue(FIXTURE.scorerModel);
    expect(screen.getByLabelText("Drafter")).toHaveValue(FIXTURE.drafterModel);
    expect(screen.getByLabelText("Embedder")).toHaveValue(FIXTURE.embedderModel);
  });

  it("empty fields show DEFAULT_MODELS placeholders for each role", () => {
    renderDefaults({
      taggerModel: "",
      scorerModel: "",
      drafterModel: "",
      embedderModel: "",
    });

    expect(screen.getByLabelText("Tagger")).toHaveAttribute(
      "placeholder",
      DEFAULT_MODELS.tagger,
    );
    expect(screen.getByLabelText("Scorer")).toHaveAttribute(
      "placeholder",
      DEFAULT_MODELS.scorer,
    );
    expect(screen.getByLabelText("Drafter")).toHaveAttribute(
      "placeholder",
      DEFAULT_MODELS.drafter,
    );
    expect(screen.getByLabelText("Embedder")).toHaveAttribute(
      "placeholder",
      DEFAULT_MODELS.embedder,
    );
  });

  it("Save calls action with all four current values and toasts success on ok:true", async () => {
    mocks.updateGlobalModelDefaultsAction.mockResolvedValue({
      ok: true,
      settings: {
        ...FIXTURE,
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
    });
    renderDefaults();

    const next = {
      taggerModel: "org/new-tagger",
      scorerModel: "org/new-scorer",
      drafterModel: "org/new-drafter",
      embedderModel: "org/new-embedder",
    };
    fireEvent.change(screen.getByLabelText("Tagger"), {
      target: { value: next.taggerModel },
    });
    fireEvent.change(screen.getByLabelText("Scorer"), {
      target: { value: next.scorerModel },
    });
    fireEvent.change(screen.getByLabelText("Drafter"), {
      target: { value: next.drafterModel },
    });
    fireEvent.change(screen.getByLabelText("Embedder"), {
      target: { value: next.embedderModel },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save models" }));

    await waitFor(() => {
      expect(mocks.updateGlobalModelDefaultsAction).toHaveBeenCalledWith(next);
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Default models saved");
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("failure toasts error and keeps draft input values", async () => {
    mocks.updateGlobalModelDefaultsAction.mockResolvedValue({
      ok: false,
      error: "Invalid model ID for tagger. Use an OpenRouter-style id like provider/model (max 256 characters, no whitespace).",
    });
    renderDefaults();

    const draft = "not-a-valid-id";
    fireEvent.change(screen.getByLabelText("Tagger"), {
      target: { value: draft },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save models" }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Invalid model ID for tagger. Use an OpenRouter-style id like provider/model (max 256 characters, no whitespace).",
      );
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Tagger")).toHaveValue(draft);
    expect(screen.getByLabelText("Scorer")).toHaveValue(FIXTURE.scorerModel);
    expect(screen.getByLabelText("Drafter")).toHaveValue(FIXTURE.drafterModel);
    expect(screen.getByLabelText("Embedder")).toHaveValue(FIXTURE.embedderModel);
  });
});
