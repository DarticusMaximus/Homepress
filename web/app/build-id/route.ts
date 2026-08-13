import { readWebBuildId } from "@/lib/build-id";

export const dynamic = "force-dynamic";

export function GET() {
  const stamp = readWebBuildId();

  return new Response(stamp, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
