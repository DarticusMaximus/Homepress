/** Flat row for Schedules list (newsletter id/name + schedule view fields). */
export type ScheduleListRow = {
  $id: string;
  name: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  nextFireAt: string | null;
};
