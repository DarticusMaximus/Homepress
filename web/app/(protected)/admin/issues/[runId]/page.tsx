import { IssueDetailView } from "@/components/issues/issue-detail-view";

type AdminIssueDetailPageProps = {
  params: Promise<{ runId: string }>;
};

export default async function AdminIssueDetailPage({ params }: AdminIssueDetailPageProps) {
  const { runId } = await params;
  return <IssueDetailView runId={runId} showOps={true} />;
}
