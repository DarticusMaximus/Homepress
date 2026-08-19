import Link from "next/link";
import type { Run } from "@newsletter/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatOperatorDate } from "@/lib/format-operator-datetime";

export type HomeIssueCardProps = {
  issue: Run;
  title: string;
  dek: string | null;
};

/**
 * Blog-style issue card (title, newsletter · date, optional dek). Reusable —
 * no Home-route coupling. The whole card is one link to the issue reader.
 */
export function HomeIssueCard({ issue, title, dek }: HomeIssueCardProps) {
  const dateLabel = formatOperatorDate(issue.endedAt ?? issue.startedAt);

  return (
    <Link
      href={`/issues/${issue.$id}`}
      className="block rounded-xl outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{title}</h2>
          </CardTitle>
          <CardDescription>
            {issue.newsletterName} · {dateLabel}
          </CardDescription>
        </CardHeader>
        {dek ? (
          <CardContent>
            <p className="line-clamp-2 text-sm text-muted-foreground">{dek}</p>
          </CardContent>
        ) : null}
      </Card>
    </Link>
  );
}
