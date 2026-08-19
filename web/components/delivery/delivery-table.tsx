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
import { DeliveryListCard } from "@/components/delivery/delivery-list-card";
import { DeliveryStatusBadge } from "@/components/delivery/delivery-status-badge";
import {
  formatDeliveryFailureText,
  formatDeliveryIssueDate,
} from "@/components/delivery/delivery-display";
import { buildAdminIssueHref } from "@/components/issues/issue-url";

type DeliveryTableProps = {
  issues: Run[];
  /** Resolved display titles keyed by run id (page-scoped enrichment). */
  titleByRunId?: ReadonlyMap<string, string>;
};

export function DeliveryTable({ issues, titleByRunId }: DeliveryTableProps) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Newsletter</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>RSS</TableHead>
          <TableHead>Failure</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((issue) => {
          const dateIso = issue.endedAt ?? issue.startedAt;
          const title =
            titleByRunId?.get(issue.$id) ?? formatIssueFallbackTitle(issue.newsletterName, dateIso);
          const href = buildAdminIssueHref(issue.$id);
          const failure = formatDeliveryFailureText(issue);
          return (
            <TableRow key={issue.$id}>
              <TableCell className="max-w-[280px] font-medium">
                <Link href={href} className="block truncate hover:underline" title={title}>
                  {title}
                </Link>
              </TableCell>
              <TableCell>{issue.newsletterName}</TableCell>
              <TableCell>{formatDeliveryIssueDate(dateIso)}</TableCell>
              <TableCell>
                <DeliveryStatusBadge channel="email" status={issue.emailDeliveryStatus} />
              </TableCell>
              <TableCell>
                <DeliveryStatusBadge channel="rss" status={issue.rssDeliveryStatus} />
              </TableCell>
              <TableCell className="max-w-[280px]">
                {failure ? (
                  <span className="block truncate" title={failure}>
                    {failure}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
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
        return <DeliveryListCard key={issue.$id} issue={issue} title={title} />;
      })}
    </>
  );

  return <ResponsiveList table={table} cards={cards} />;
}
