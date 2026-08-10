/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SchedulesView } from "@/components/schedules/schedules-view";

afterEach(() => {
  cleanup();
});

/** Locked Feature 06 Schedules downtime / no-catch-up copy. */
const MISSED_FIRES_NOTE =
  "If the worker was offline across scheduled times, only the latest due window runs — missed fires are not queued as catch-up.";

describe("Schedules missed-fires note (Feature 06 Task 1 case 12)", () => {
  it("shows the locked no-catch-up sentence under the Schedules heading", () => {
    render(
      <SchedulesView
        schedules={[
          {
            $id: "nl-1",
            name: "Morning Digest",
            enabled: true,
            cron: "0 9 * * 1-5",
            timezone: "America/New_York",
            nextFireAt: "2026-07-17T13:00:00.000Z",
          },
        ]}
        total={1}
        loadError={null}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Schedules" })).toBeInTheDocument();
    expect(screen.getByText(MISSED_FIRES_NOTE)).toBeInTheDocument();
  });

  it("shows the locked note even when the schedules list is empty", () => {
    render(<SchedulesView schedules={[]} total={0} loadError={null} />);

    expect(screen.getByText(MISSED_FIRES_NOTE)).toBeInTheDocument();
  });
});
