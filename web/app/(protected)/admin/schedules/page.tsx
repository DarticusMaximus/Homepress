import { redirect } from "next/navigation";
import {
  getServerAppwrite,
  listNewsletters,
  NewsletterRepositoryError,
  toNewsletterScheduleView,
  type Newsletter,
} from "@newsletter/shared";
import { SchedulesPagination } from "@/components/schedules/schedules-pagination";
import type { ScheduleListRow } from "@/components/schedules/schedule-list-row";
import { SchedulesView } from "@/components/schedules/schedules-view";
import { Alert, AlertDescription } from "@/components/ui/alert";

const PAGE_SIZE = 20;

type SchedulesPageProps = {
  searchParams: Promise<{ page?: string }>;
};

function parsePageParam(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function toScheduleListRow(newsletter: Newsletter, now: Date): ScheduleListRow {
  const schedule = toNewsletterScheduleView(newsletter, now);
  return {
    $id: newsletter.$id,
    name: newsletter.name,
    enabled: schedule.enabled,
    cron: schedule.cron,
    timezone: schedule.timezone,
    nextFireAt: schedule.nextFireAt,
  };
}

function sortScheduleRows(rows: ScheduleListRow[]): ScheduleListRow[] {
  return [...rows].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.$id.localeCompare(b.$id);
  });
}

export default async function SchedulesPage({ searchParams }: SchedulesPageProps) {
  const { page: pageParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);

  let allSchedules: ScheduleListRow[] = [];
  let loadError: string | null = null;

  try {
    const newsletters = await listNewsletters(getServerAppwrite());
    const now = new Date();
    allSchedules = sortScheduleRows(newsletters.map((nl) => toScheduleListRow(nl, now)));
  } catch (err) {
    loadError =
      err instanceof NewsletterRepositoryError
        ? err.message
        : "Something went wrong while loading schedules. Please try again.";
    console.error("[schedules/page]", err);
  }

  const total = allSchedules.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total > 0 && requestedPage > totalPages) {
    redirect(totalPages === 1 ? "/admin/schedules" : `/admin/schedules?page=${totalPages}`);
  }

  const page = total === 0 ? 1 : requestedPage;
  const start = (page - 1) * PAGE_SIZE;
  const schedules = allSchedules.slice(start, start + PAGE_SIZE);

  return (
    <main>
      {loadError && (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <SchedulesView schedules={schedules} total={total} loadError={loadError} />

      <SchedulesPagination page={page} totalPages={totalPages} total={total} />
    </main>
  );
}
