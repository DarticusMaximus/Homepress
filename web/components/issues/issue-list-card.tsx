import Link from "next/link";
import { formatIssueFallbackTitle, type Run } from "@newsletter/shared";
import { DomainListCard, DomainListField } from "@/components/domain-list";
import { Button } from "@/components/ui/button";
import { DeliveryStatusBadge } from "@/components/delivery/delivery-status-badge";
import { buildAdminIssueHref } from "@/components/issues/issue-url";
import { formatOperatorDate } from "@/lib/format-operator-datetime";

function formatIssueDate(iso: string): string {
  return formatOperatorDate(iso);
}

type IssueListCardProps = {
  issue: Run;
  /** Resolved display title; falls back to Feature 01 format when omitted. */
  title?: string;
};

export function IssueListCard({ issue, title: titleProp }: IssueListCardProps) {
  const dateIso = issue.endedAt ?? issue.startedAt;
  const title = titleProp ?? formatIssueFallbackTitle(issue.newsletterName, dateIso);
  const href = buildAdminIssueHref(issue.$id);

  return (
    <DomainListCard
      title={
        <Link href={href} className="hover:underline" title={title}>
          {title}
        </Link>
      }
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href={href}>Open</Link>
        </Button>
      }
    >
      <DomainListField label="Newsletter">
        <span>{issue.newsletterName}</span>
      </DomainListField>
      <DomainListField label="Date">
        <span>{formatIssueDate(dateIso)}</span>
      </DomainListField>
      <DomainListField label="Email" className="flex flex-wrap items-center gap-2">
        <DeliveryStatusBadge channel="email" status={issue.emailDeliveryStatus} />
      </DomainListField>
      <DomainListField label="RSS" className="flex flex-wrap items-center gap-2">
        <DeliveryStatusBadge channel="rss" status={issue.rssDeliveryStatus} />
      </DomainListField>
    </DomainListCard>
  );
}
