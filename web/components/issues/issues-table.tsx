import Link from "next/link";
import { formatIssueFallbackTitle, type Run } from "@newsletter/shared";
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
import { DeliveryStatusBadge } from "@/components/delivery/delivery-status-badge";
import { IssueListCard } from "@/components/issues/issue-list-card";
import { formatOperatorDate } from "@/lib/format-operator-datetime";

function formatIssueDate(iso: string): string {
  return formatOperatorDate(iso);
}

type IssuesTableProps = {
  issues: Run[];
  /** Resolved display titles keyed by run id (page-scoped enrichment). */
  titleByRunId?: ReadonlyMap<string, string>;
};

export function IssuesTable({ issues, titleByRunId }: IssuesTableProps) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Newsletter</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>RSS</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((issue) => {
          const dateIso = issue.endedAt ?? issue.startedAt;
          const title =
            titleByRunId?.get(issue.$id) ?? formatIssueFallbackTitle(issue.newsletterName, dateIso);
          const href = `/issues/${issue.$id}`;
          return (
            <TableRow key={issue.$id}>
              <TableCell className="max-w-[320px] font-medium">
                <Link href={href} className="block truncate hover:underline" title={title}>
                  {title}
                </Link>
              </TableCell>
              <TableCell>{issue.newsletterName}</TableCell>
              <TableCell>{formatIssueDate(dateIso)}</TableCell>
              <TableCell>
                <DeliveryStatusBadge channel="email" status={issue.emailDeliveryStatus} />
              </TableCell>
              <TableCell>
                <DeliveryStatusBadge channel="rss" status={issue.rssDeliveryStatus} />
              </TableCell>
              <TableCell className="text-right">
                <Button variant="outline" size="sm" asChild>
                  <Link href={href}>Open</Link>
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const cards = (
    <>
      {issues.map((issue) => {
        const dateIso = issue.endedAt ?? issue.startedAt;
        const title =
          titleByRunId?.get(issue.$id) ?? formatIssueFallbackTitle(issue.newsletterName, dateIso);
        return <IssueListCard key={issue.$id} issue={issue} title={title} />;
      })}
    </>
  );

  return <ResponsiveList table={table} cards={cards} />;
}
