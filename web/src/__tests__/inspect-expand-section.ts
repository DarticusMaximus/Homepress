import { expect } from "vitest";
import { fireEvent, within } from "@testing-library/react";

/**
 * Expand an Inspect phase/section collapsible by its aria-label (e.g. "Fetched").
 * Feature 04 — used after chrome defaults to collapsed.
 */
export function expandInspectSection(container: HTMLElement, label: string): void {
  const section = container.querySelector(
    `section[aria-label="${label}"]`,
  ) as HTMLElement | null;
  expect(section).not.toBeNull();
  const trigger = within(section!).getByRole("button", {
    name: new RegExp(`^${label}`),
  });
  fireEvent.click(trigger);
}
