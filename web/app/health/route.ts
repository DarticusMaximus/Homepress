import { Databases } from "node-appwrite";
import { getServerAppwrite, sanitizeAppwriteMessageForLog } from "@newsletter/shared";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = getServerAppwrite();
    const databases = new Databases(client);
    await databases.list();

    return Response.json({ status: "ok" });
  } catch (err) {
    const errString = err instanceof Error ? err.message : String(err);
    console.error("[/health] Appwrite handshake failed:", {
      message: sanitizeAppwriteMessageForLog(errString),
    });

    return Response.json(
      {
        status: "degraded",
        message: "Appwrite handshake failed",
      },
      { status: 503 },
    );
  }
}
