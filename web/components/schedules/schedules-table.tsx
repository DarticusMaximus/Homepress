"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResponsiveList } from "@/components/domain-list";
import { formatScheduleNextFireAt } from "@/components/schedules/format-schedule-next-fire";
import { ScheduleEditDialog } from "@/components/schedules/schedule-edit-dialog";
import { ScheduleListCard } from "@/components/schedules/schedule-list-card";
import type { ScheduleListRow } from "@/components/schedules/schedule-list-row";

type SchedulesTableProps = {
  schedules: ScheduleListRow[];
};

function ScheduleRowActions({
  schedule,
  onEditSchedule,
}: {
  schedule: ScheduleListRow;
  onEditSchedule: (schedule: ScheduleListRow) => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Edit schedule ${schedule.name}`}
        onClick={() => onEditSchedule(schedule)}
      >
        Edit schedule
      </Button>
      <Button variant="outline" size="sm" asChild>
        <Link
          href={`/newsletters/${schedule.$id}`}
          aria-label={`Edit newsletter ${schedule.name}`}
        >
          Edit newsletter
        </Link>
      </Button>
    </div>
  );
}

export function SchedulesTable({ schedules }: SchedulesTableProps) {
  const [editTarget, setEditTarget] = useState<ScheduleListRow | null>(null);

  const onEditSchedule = (schedule: ScheduleListRow) => setEditTarget(schedule);

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Newsletter</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Cron</TableHead>
          <TableHead>Timezone</TableHead>
          <TableHead>Next fire</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {schedules.map((schedule) => {
          const cronDisplay = schedule.cron.length > 0 ? schedule.cron : "—";
          const nextFireDisplay = formatScheduleNextFireAt(schedule.nextFireAt);
          return (
            <TableRow key={schedule.$id}>
              <TableCell className="font-medium">{schedule.name}</TableCell>
              <TableCell>
                <Badge variant={schedule.enabled ? "default" : "secondary"}>
                  {schedule.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </TableCell>
              <TableCell>
                {schedule.cron.length > 0 ? (
                  <span className="font-mono">{cronDisplay}</span>
                ) : (
                  <span className="text-muted-foreground">{cronDisplay}</span>
                )}
              </TableCell>
              <TableCell>{schedule.timezone}</TableCell>
              <TableCell>
                {schedule.nextFireAt ? (
                  nextFireDisplay
                ) : (
                  <span className="text-muted-foreground">{nextFireDisplay}</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <ScheduleRowActions schedule={schedule} onEditSchedule={onEditSchedule} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const cards = (
    <>
      {schedules.map((schedule) => (
        <ScheduleListCard
          key={schedule.$id}
          schedule={schedule}
          onEditSchedule={onEditSchedule}
        />
      ))}
    </>
  );

  return (
    <>
      <ResponsiveList table={table} cards={cards} />

      {editTarget && (
        <ScheduleEditDialog
          key={editTarget.$id}
          schedule={editTarget}
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        />
      )}
    </>
  );
}
