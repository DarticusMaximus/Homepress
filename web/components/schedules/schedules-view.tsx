"use client";

import { SchedulesTable } from "@/components/schedules/schedules-table";
import type { ScheduleListRow } from "@/components/schedules/schedule-list-row";

type SchedulesViewProps = {
  schedules: ScheduleListRow[];
  total: number;
  loadError: string | null;
};

/** Locked Feature 06 — no catch-up after worker downtime. */
const SCHEDULES_MISSED_FIRES_NOTE =
  "If the worker was offline across scheduled times, only the latest due window runs — missed fires are not queued as catch-up.";

export function SchedulesView({ schedules, total, loadError }: SchedulesViewProps) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Schedules</h1>
        <p className="text-sm text-muted-foreground">
          Per-newsletter cron schedules — enable state and next fire.
        </p>
        <p className="text-sm text-muted-foreground">{SCHEDULES_MISSED_FIRES_NOTE}</p>
      </div>

      {loadError ? null : total === 0 ? (
        <section
          aria-label="Schedules list"
          className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center"
        >
          <p className="text-sm text-muted-foreground">
            No newsletters yet. Create a newsletter first, then set its schedule here.
          </p>
        </section>
      ) : (
        <section aria-label="Schedules list" className="mt-8">
          <SchedulesTable schedules={schedules} />
        </section>
      )}
    </>
  );
}
