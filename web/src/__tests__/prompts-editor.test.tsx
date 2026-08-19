/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  PROMPT_PLACEHOLDERS,
  type PromptTemplate,
} from "@newsletter/shared/client";
import { PromptsEditor } from "@/components/prompts/prompts-editor";

const mocks = vi.hoisted(() => ({
  updatePromptTemplateAction: vi.fn(),
  resetPromptTemplateAction: vi.fn(),
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
  updatePromptTemplateAction: mocks.updatePromptTemplateAction,
  resetPromptTemplateAction: mocks.resetPromptTemplateAction,
}));

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
}));

const FIXTURE_TEMPLATES: PromptTemplate[] = [
  {
    role: "tagger",
    body: "Tagger body with {title} and {truncated_content}",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    role: "scorer",
    body: "Scorer body with {topics} {disliked_topics} {tags} {title}",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    role: "drafter",
    body: "Drafter body with {newsletter_name} {topics} {articles_json} {count}",
    updatedAt: "2026-01-03T00:00:00.000Z",
  },
];

function renderEditor(templates: PromptTemplate[] = FIXTURE_TEMPLATES) {
  return render(<PromptsEditor templates={templates} />);
}

function getActiveTextarea() {
  return screen.getByRole("textbox");
}

afterEach(() => {
  cleanup();
  mocks.updatePromptTemplateAction.mockReset();
  mocks.resetPromptTemplateAction.mockReset();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

describe("PromptsEditor — tabs and placeholders", () => {
  it("renders three role tabs; default is Tagger with tagger placeholder chips", () => {
    renderEditor();

    expect(screen.getByRole("tab", { name: "Tagger" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Scorer" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Drafter" })).toBeInTheDocument();

    const taggerTab = screen.getByRole("tab", { name: "Tagger" });
    expect(taggerTab).toHaveAttribute("data-state", "active");

    for (const name of PROMPT_PLACEHOLDERS.tagger) {
      expect(screen.getByText(`{${name}}`)).toBeInTheDocument();
    }
    expect(screen.getByText("{title}")).toBeInTheDocument();
    expect(screen.getByText("{truncated_content}")).toBeInTheDocument();

    expect(getActiveTextarea()).toHaveValue(FIXTURE_TEMPLATES[0].body);
  });

  it("switching to Scorer shows scorer placeholder chips and that role's body", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("tab", { name: "Scorer" }));

    expect(screen.getByRole("tab", { name: "Scorer" })).toHaveAttribute("data-state", "active");
    expect(getActiveTextarea()).toHaveValue(FIXTURE_TEMPLATES[1].body);

    for (const name of PROMPT_PLACEHOLDERS.scorer) {
      // Exact `{name}` — loose /\{?topics\}?/ also matches `{disliked_topics}`.
      expect(screen.getByText(`{${name}}`)).toBeInTheDocument();
    }
  });

  it("switching to Drafter shows drafter placeholder chips including {audience}", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("tab", { name: "Drafter" }));

    expect(screen.getByRole("tab", { name: "Drafter" })).toHaveAttribute("data-state", "active");
    expect(getActiveTextarea()).toHaveValue(FIXTURE_TEMPLATES[2].body);

    for (const name of PROMPT_PLACEHOLDERS.drafter) {
      expect(screen.getByText(`{${name}}`)).toBeInTheDocument();
    }
    expect(screen.getByText("{audience}")).toBeInTheDocument();
  });
});

describe("PromptsEditor — Save action", () => {
  it("edit + Save calls updatePromptTemplateAction with role and body; success toasts", async () => {
    mocks.updatePromptTemplateAction.mockResolvedValue({
      ok: true,
      template: {
        role: "tagger",
        body: "Updated tagger {title} {truncated_content}",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      warnings: [],
    });
    renderEditor();

    const nextBody = "Updated tagger {title} {truncated_content}";
    fireEvent.change(getActiveTextarea(), { target: { value: nextBody } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.updatePromptTemplateAction).toHaveBeenCalledWith("tagger", nextBody);
    });
    expect(mocks.toast.success).toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("Save failure shows toast.error with the message and no success toast", async () => {
    mocks.updatePromptTemplateAction.mockResolvedValue({
      ok: false,
      error: "Missing required placeholders: title",
    });
    renderEditor();

    fireEvent.change(getActiveTextarea(), {
      target: { value: "broken body without placeholders" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith("Missing required placeholders: title");
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("Save with warnings shows success and toast.warning mentioning the warning", async () => {
    mocks.updatePromptTemplateAction.mockResolvedValue({
      ok: true,
      template: {
        role: "tagger",
        body: "Tagger with {title} {truncated_content} {foo}",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      warnings: ["foo"],
    });
    renderEditor();

    fireEvent.change(getActiveTextarea(), {
      target: { value: "Tagger with {title} {truncated_content} {foo}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.toast.success).toHaveBeenCalled();
    });
    expect(mocks.toast.warning).toHaveBeenCalledWith(expect.stringContaining("foo"));
  });

  it("disables Save and shows Saving… while the transition is pending", async () => {
    let resolveSave!: (v: {
      ok: true;
      template: PromptTemplate;
      warnings: string[];
    }) => void;
    mocks.updatePromptTemplateAction.mockImplementation(
      () =>
        new Promise((r) => {
          resolveSave = r;
        }),
    );
    renderEditor();

    fireEvent.change(getActiveTextarea(), {
      target: { value: "Pending save {title} {truncated_content}" },
    });
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeEnabled();

    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    });

    await act(async () => {
      resolveSave({
        ok: true,
        template: {
          role: "tagger",
          body: "Pending save {title} {truncated_content}",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });
    expect(mocks.toast.success).toHaveBeenCalled();
  });
});

describe("PromptsEditor — draft preservation", () => {
  it("keeps unsaved Tagger edits after switching to Scorer and back without saving", () => {
    renderEditor();

    const draft = "Unsaved tagger draft {title} {truncated_content}";
    fireEvent.change(getActiveTextarea(), { target: { value: draft } });

    fireEvent.click(screen.getByRole("tab", { name: "Scorer" }));
    expect(getActiveTextarea()).toHaveValue(FIXTURE_TEMPLATES[1].body);

    fireEvent.click(screen.getByRole("tab", { name: "Tagger" }));
    expect(getActiveTextarea()).toHaveValue(draft);
    expect(mocks.updatePromptTemplateAction).not.toHaveBeenCalled();
  });
});

describe("PromptsEditor — Reset to default", () => {
  it("shows Reset to default button for the active role", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "Reset to default" })).toBeInTheDocument();
  });

  it("opens confirm dialog; confirming calls reset for active role and updates textarea", async () => {
    const resetBody = "Shipped tagger default {title} {truncated_content}";
    mocks.resetPromptTemplateAction.mockResolvedValue({
      ok: true,
      template: {
        role: "tagger",
        body: resetBody,
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      warnings: [],
    });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(screen.getByRole("heading", { name: "Reset to shipped default" })).toBeInTheDocument();
    expect(screen.getByText(/Tagger template will be replaced/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(mocks.resetPromptTemplateAction).toHaveBeenCalledWith("tagger");
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Tagger prompt reset to default");
    expect(getActiveTextarea()).toHaveValue(resetBody);
    expect(screen.queryByRole("heading", { name: "Reset to shipped default" })).not.toBeInTheDocument();
  });

  it("Cancel does not call resetPromptTemplateAction", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(screen.getByRole("heading", { name: "Reset to shipped default" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.resetPromptTemplateAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Reset to shipped default" })).not.toBeInTheDocument();
  });

  it("preserves Tagger unsaved draft when Scorer is reset", async () => {
    const scorerResetBody = "Shipped scorer {topics} {disliked_topics} {tags} {title}";
    mocks.resetPromptTemplateAction.mockResolvedValue({
      ok: true,
      template: {
        role: "scorer",
        body: scorerResetBody,
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      warnings: [],
    });
    renderEditor();

    const taggerDraft = "Unsaved tagger draft {title} {truncated_content}";
    fireEvent.change(getActiveTextarea(), { target: { value: taggerDraft } });

    fireEvent.click(screen.getByRole("tab", { name: "Scorer" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(mocks.resetPromptTemplateAction).toHaveBeenCalledWith("scorer");
    });
    expect(getActiveTextarea()).toHaveValue(scorerResetBody);

    fireEvent.click(screen.getByRole("tab", { name: "Tagger" }));
    expect(getActiveTextarea()).toHaveValue(taggerDraft);
  });

  it("failure shows toast.error and no success toast", async () => {
    mocks.resetPromptTemplateAction.mockResolvedValue({
      ok: false,
      error: "Something went wrong while resetting the prompt template.",
    });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Something went wrong while resetting the prompt template.",
      );
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Reset to shipped default" })).toBeInTheDocument();
  });

  it("disables Reset controls while Reset is in flight; disables Reset to default while Save is in flight", async () => {
    let resolveReset!: (v: {
      ok: true;
      template: PromptTemplate;
      warnings: string[];
    }) => void;
    mocks.resetPromptTemplateAction.mockImplementation(
      () =>
        new Promise((r) => {
          resolveReset = r;
        }),
    );

    let resolveSave!: (v: {
      ok: true;
      template: PromptTemplate;
      warnings: string[];
    }) => void;
    mocks.updatePromptTemplateAction.mockImplementation(
      () =>
        new Promise((r) => {
          resolveSave = r;
        }),
    );

    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    const confirmButton = screen.getByRole("button", { name: "Reset" });

    await act(async () => {
      fireEvent.click(confirmButton);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resetting…" })).toBeDisabled();
    });
    // Dialog focus trap aria-hides page content; still assert the trigger is disabled.
    expect(screen.getByRole("button", { name: "Reset to default", hidden: true })).toBeDisabled();

    await act(async () => {
      resolveReset({
        ok: true,
        template: {
          role: "tagger",
          body: "Reset body {title} {truncated_content}",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset to default" })).toBeEnabled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Reset to default" })).toBeDisabled();

    await act(async () => {
      resolveSave({
        ok: true,
        template: {
          role: "tagger",
          body: "Reset body {title} {truncated_content}",
          updatedAt: "2026-03-02T00:00:00.000Z",
        },
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset to default" })).toBeEnabled();
    });
  });
});

describe("PROMPT_PLACEHOLDERS export", () => {
  it("exposes allow-lists for all three roles without braces", () => {
    expect(PROMPT_PLACEHOLDERS.tagger).toEqual(
      expect.arrayContaining(["title", "truncated_content"]),
    );
    expect(PROMPT_PLACEHOLDERS.scorer).toEqual(
      expect.arrayContaining(["topics", "disliked_topics", "tags", "title"]),
    );
    expect(PROMPT_PLACEHOLDERS.drafter).toEqual(
      expect.arrayContaining([
        "newsletter_name",
        "topics",
        "articles_json",
        "count",
        "audience",
      ]),
    );
  });
});
