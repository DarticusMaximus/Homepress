"use client";

import Link from "next/link";
import { DomainListCard, DomainListField } from "@/components/domain-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatScheduleNextFireAt } from "@/components/schedules/format-schedule-next-fire";
import type { ScheduleListRow } from "@/components/schedules/schedule-list-row";

type ScheduleListCardProps = {
  schedule: ScheduleListRow;
  onEditSchedule: (schedule: ScheduleListRow) => void;
};

export function ScheduleListCard({ schedule, onEditSchedule }: ScheduleListCardProps) {
  const cronDisplay = schedule.cron.length > 0 ? schedule.cron : "—";
  const nextFireDisplay = formatScheduleNextFireAt(schedule.nextFireAt);

  return (
    <DomainListCard
      title={schedule.name}
      badges={
        <Badge variant={schedule.enabled ? "default" : "secondary"}>
          {schedule.enabled ? "Enabled" : "Disabled"}
        </Badge>
      }
      actions={
        <>
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
              href={`/admin/newsletters/${schedule.$id}`}
              aria-label={`Edit newsletter ${schedule.name}`}
            >
              Edit newsletter
            </Link>
          </Button>
        </>
      }
    >
      <DomainListField label="Cron">
        {schedule.cron.length > 0 ? (
          <span className="font-mono">{cronDisplay}</span>
        ) : (
          <span className="text-muted-foreground">{cronDisplay}</span>
        )}
      </DomainListField>
      <DomainListField label="Timezone">
        <span>{schedule.timezone}</span>
      </DomainListField>
      <DomainListField label="Next fire">
        {schedule.nextFireAt ? (
          <span>{nextFireDisplay}</span>
        ) : (
          <span className="text-muted-foreground">{nextFireDisplay}</span>
        )}
      </DomainListField>
    </DomainListCard>
  );
}
