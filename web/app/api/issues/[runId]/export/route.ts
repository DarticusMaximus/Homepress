import {
  getServerAppwrite,
  IssueLoadError,
  prepareIssueExport,
  type IssueExportFormat,
} from "@newsletter/shared";
import { getAuthenticatedUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const PLAIN_TEXT = "text/plain; charset=utf-8";

function plainError(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": PLAIN_TEXT },
  });
}

function isExportFormat(value: string | null): value is IssueExportFormat {
  return value === "md" || value === "html";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return plainError(401, "Unauthorized");
  }

  const { runId } = await params;
  const format = new URL(request.url).searchParams.get("format");

  if (!isExportFormat(format)) {
    return plainError(400, "Invalid export format");
  }

  try {
    const client = getServerAppwrite();
    const payload = await prepareIssueExport(client, runId, format);

    return new Response(payload.body, {
      status: 200,
      headers: {
        "Content-Type": payload.contentType,
        "Content-Disposition": `attachment; filename="${payload.filename}"`,
      },
    });
  } catch (err) {
    if (err instanceof IssueLoadError) {
      return plainError(404, "Couldn’t load this issue for export");
    }
    if (err instanceof Error && err.message === "Issue draft is empty") {
      return plainError(400, "Issue draft is empty");
    }
    return plainError(500, "Failed to export issue");
  }
}
