"use client";

import { useActionState, useEffect } from "react";
import {
  updateNewsletterScheduleAction,
  type ScheduleActionResult,
} from "@/app/(protected)/admin/schedules/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import type { ScheduleListRow } from "@/components/schedules/schedule-list-row";
import { ScheduleFields } from "@/components/schedules/schedule-fields";

type ScheduleEditDialogProps = {
  schedule: ScheduleListRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Edit enable/cron/timezone for one newsletter from the Schedules list.
 * Pre-fill comes from `schedule` props; parent remounts via `key={schedule.$id}`
 * when switching rows so defaults never stay stale.
 */
export function ScheduleEditDialog({ schedule, open, onOpenChange }: ScheduleEditDialogProps) {
  const [state, formAction, isPending] = useActionState<ScheduleActionResult | null, FormData>(
    updateNewsletterScheduleAction,
    null,
  );

  useEffect(() => {
    if (!open || !state) return;
    if (state.ok) {
      toast.success("Schedule updated");
      onOpenChange(false);
    } else {
      toast.error(state.error);
    }
  }, [state, open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit schedule</DialogTitle>
          <DialogDescription>
            Cron schedule for {schedule.name}. Save to enable or update the next fire.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="newsletterId" value={schedule.$id} />

          <ScheduleFields
            idPrefix={schedule.$id}
            defaultEnabled={schedule.enabled}
            defaultCron={schedule.cron}
            defaultTimezone={schedule.timezone}
            disabled={isPending}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
