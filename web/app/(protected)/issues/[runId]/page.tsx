import { IssueDetailView } from "@/components/issues/issue-detail-view";

type IssueDetailPageProps = {
  params: Promise<{ runId: string }>;
};

export default async function IssueDetailPage({ params }: IssueDetailPageProps) {
  const { runId } = await params;
  return <IssueDetailView runId={runId} showOps={false} />;
}
