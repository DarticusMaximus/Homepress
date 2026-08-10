import { formatOperatorDateTime } from "@/lib/format-operator-datetime";

/** Locale short datetime for schedule next fire, or em dash when absent. */
export function formatScheduleNextFireAt(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  return formatOperatorDateTime(iso);
}
