import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PhaseSectionChrome } from "@/components/runs/inspect-phase-chrome";

describe("PhaseSectionChrome (Feature 04 Task 2)", () => {
  it("renders a closed trigger with label and count", () => {
    const { container } = render(
      <PhaseSectionChrome label="Fetched" count={12}>
        <p>Body content</p>
      </PhaseSectionChrome>,
    );

    const section = container.querySelector(
      'section[aria-label="Fetched"]',
    ) as HTMLElement;
    expect(section).not.toBeNull();

    const trigger = within(section).getByRole("button", {
      name: /Fetched \(12\)/,
    });
    expect(trigger).toHaveTextContent("Fetched (12)");
    expect(trigger).toHaveAttribute("data-state", "closed");
    expect(within(section).queryByText("Body content")).not.toBeInTheDocument();
  });

  it("omits count from trigger when count is null", () => {
    render(
      <PhaseSectionChrome label="Tagged" count={null}>
        <p>Hidden</p>
      </PhaseSectionChrome>,
    );

    const trigger = screen.getByRole("button", { name: /^Tagged$/ });
    expect(trigger).toHaveTextContent("Tagged");
    expect(trigger).not.toHaveTextContent("(");
  });
});
