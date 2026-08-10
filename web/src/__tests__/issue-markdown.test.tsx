/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { IssueMarkdown } from "@/components/issues/issue-markdown";

afterEach(() => {
  cleanup();
});

describe("IssueMarkdown", () => {
  it("renders headings, lists, and new-tab links", () => {
    const markdown = `## Heading

- First item
- Second item

[Example](https://example.com/path)`;

    render(<IssueMarkdown markdown={markdown} />);

    expect(screen.getByRole("heading", { level: 2, name: "Heading" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("First item");

    const link = screen.getByRole("link", { name: "Example" });
    expect(link).toHaveAttribute("href", "https://example.com/path");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders GFM bare URLs as new-tab links", () => {
    render(<IssueMarkdown markdown={"Visit https://gfm.example.com/docs"} />);

    const link = screen.getByRole("link", { name: "https://gfm.example.com/docs" });
    expect(link).toHaveAttribute("href", "https://gfm.example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders GFM tables as table structure, not leftover pipes", () => {
    const markdown = `| Name | Value |
| --- | --- |
| Alpha | 1 |`;

    const { container } = render(<IssueMarkdown markdown={markdown} />);

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(within(table!).getByText("Name")).toBeInTheDocument();
    expect(within(table!).getByText("Alpha")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/^\| Name \| Value \|$/m);
  });

  it("wraps content in prose classes without a custom max-width widen", () => {
    const { container } = render(<IssueMarkdown markdown="Hello" />);
    const prose = container.querySelector(".prose");
    expect(prose).not.toBeNull();
    expect(prose?.className).toMatch(/dark:prose-invert/);
    expect(prose?.className).not.toMatch(/max-w-\[/);
  });
});
