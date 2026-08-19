/// <reference types="@testing-library/jest-dom" />

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChannelList } from "@/components/newsletters/channel-list";

afterEach(() => {
  cleanup();
});

const WEB_ROOT = path.resolve(__dirname, "../..");
const CHANNEL_LIST_PATH = path.join(WEB_ROOT, "components/newsletters/channel-list.tsx");

const EMPTY_COPY = "No newsletters yet.";
const LOAD_ERROR = "Something went wrong while loading newsletters. Please try again.";

const fixtures = [
  { $id: "nl-1", name: "Daily AI" },
  { $id: "nl-2", name: "Weekly Tech" },
];

function channelLinks(container: HTMLElement): HTMLAnchorElement[] {
  return [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/newsletters/"]')];
}

describe("ChannelList", () => {
  it("renders the Newsletters heading and each name as a channel link", () => {
    render(<ChannelList newsletters={fixtures} loadError={null} />);

    expect(screen.getByRole("heading", { name: "Newsletters" })).toBeInTheDocument();

    for (const newsletter of fixtures) {
      expect(screen.getByRole("link", { name: newsletter.name })).toHaveAttribute(
        "href",
        `/newsletters/${newsletter.$id}`,
      );
    }
  });

  it("does not show factory actions or import factory list chrome", () => {
    expect(existsSync(CHANNEL_LIST_PATH)).toBe(true);
    const source = readFileSync(CHANNEL_LIST_PATH, "utf8");
    expect(source).not.toMatch(/\bNewslettersView\b/);
    expect(source).not.toMatch(/\bNewslettersTable\b/);
    expect(source).not.toMatch(/\bGenerateNewsletterButton\b/);
    expect(source).not.toMatch(/\bResponsiveList\b/);

    render(<ChannelList newsletters={fixtures} loadError={null} />);

    expect(screen.queryByText("Create")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByText("Generate")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("shows empty copy and no links when there are no newsletters", () => {
    const { container } = render(<ChannelList newsletters={[]} loadError={null} />);

    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    expect(channelLinks(container)).toHaveLength(0);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the passed load error in an alert without empty copy or links", () => {
    const { container } = render(<ChannelList newsletters={fixtures} loadError={LOAD_ERROR} />);

    expect(screen.getByRole("heading", { name: "Newsletters" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(LOAD_ERROR);
    expect(screen.queryByText(EMPTY_COPY)).not.toBeInTheDocument();
    expect(channelLinks(container)).toHaveLength(0);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("no longer treats names as Feature 01 stub text — they are links", () => {
    render(<ChannelList newsletters={fixtures} loadError={null} />);

    expect(screen.getByRole("link", { name: "Daily AI" })).toHaveAttribute(
      "href",
      "/newsletters/nl-1",
    );
    expect(screen.getByRole("link", { name: "Weekly Tech" })).toHaveAttribute(
      "href",
      "/newsletters/nl-2",
    );
  });
});
