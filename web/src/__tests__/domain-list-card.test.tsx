/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DomainListCard, DomainListField } from "@/components/domain-list";

afterEach(() => {
  cleanup();
});

describe("DomainListCard", () => {
  it("renders title, badges, and description in the header region", () => {
    render(
      <DomainListCard
        title="Alpha Feed"
        badges={<span>Healthy</span>}
        description="https://alpha.example.com/feed.xml"
      >
        <DomainListField label="Notes">Alpha notes</DomainListField>
      </DomainListCard>,
    );

    const header = document.querySelector('[data-slot="card-header"]');
    expect(header).toBeTruthy();
    const headerScope = within(header as HTMLElement);

    expect(headerScope.getByText("Alpha Feed")).toBeInTheDocument();
    expect(headerScope.getByText("Healthy")).toBeInTheDocument();

    const description = headerScope.getByText("https://alpha.example.com/feed.xml");
    expect(description.tagName).toBe("P");
    expect(description).toHaveClass("text-sm", "break-all", "text-muted-foreground");
  });

  it("renders DomainListField rows with muted `{label}: ` suffix and values", () => {
    render(
      <DomainListCard title="Beta Feed">
        <DomainListField label="Notes">Beta notes</DomainListField>
        <DomainListField label="Updated">3/15/2026</DomainListField>
      </DomainListCard>,
    );

    const content = document.querySelector('[data-slot="card-content"]');
    expect(content).toBeTruthy();
    const contentScope = within(content as HTMLElement);

    // Default Testing Library normalizer trims trailing spaces; keep them so
    // `/^Label:\s$/` can assert the pinned `{label}: ` suffix.
    const keepTrailingSpace = (value: string) => value.replace(/\s+/g, " ");
    const notesLabel = contentScope.getByText(/^Notes:\s$/, {
      normalizer: keepTrailingSpace,
    });
    expect(notesLabel).toHaveClass("text-muted-foreground");
    expect(notesLabel.textContent).toBe("Notes: ");
    expect(contentScope.getByText("Beta notes")).toBeInTheDocument();

    const updatedLabel = contentScope.getByText(/^Updated:\s$/, {
      normalizer: keepTrailingSpace,
    });
    expect(updatedLabel).toHaveClass("text-muted-foreground");
    expect(updatedLabel.textContent).toBe("Updated: ");
    expect(contentScope.getByText("3/15/2026")).toBeInTheDocument();
  });

  it("renders actions in the footer when provided and omits footer when absent", () => {
    const { rerender } = render(
      <DomainListCard title="With actions" actions={<button type="button">Edit</button>}>
        <DomainListField label="Notes">—</DomainListField>
      </DomainListCard>,
    );

    const footer = document.querySelector('[data-slot="card-footer"]');
    expect(footer).toBeTruthy();
    expect(within(footer as HTMLElement).getByRole("button", { name: "Edit" })).toBeInTheDocument();

    rerender(
      <DomainListCard title="Without actions">
        <DomainListField label="Notes">—</DomainListField>
      </DomainListCard>,
    );

    expect(document.querySelector('[data-slot="card-footer"]')).toBeNull();
    expect(screen.getByText("Without actions")).toBeInTheDocument();
  });

  it("accepts a ReactNode title (link) without wrapping it in an extra interactive element", () => {
    render(
      <DomainListCard
        title={
          <a href="/issues/run-1" className="hover:underline">
            Issue title link
          </a>
        }
      >
        <DomainListField label="Newsletter">Daily Digest</DomainListField>
      </DomainListCard>,
    );

    const link = screen.getByRole("link", { name: "Issue title link" });
    expect(link).toHaveAttribute("href", "/issues/run-1");

    // Title link must be the only interactive ancestor of the title text —
    // DomainListCard must not wrap ReactNode titles in another <a>/<button>.
    expect(link.parentElement?.closest("a, button")).toBeNull();
  });
});
