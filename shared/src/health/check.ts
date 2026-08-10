/**
 * Database health round-trip (Task 1).
 *
 * Pure async function: takes a node-appwrite `Client`, runs a three-step
 * round-trip against `HEALTH_CHECK_COLLECTION_ID` (create → read → delete),
 * and returns a typed `HealthCheckResult` with per-step status, duration, and
 * any error message / code from a failed step. The page (Task 2) wraps this
 * in an outer try/catch for pre-step failures (e.g. `getServerAppwrite()`
 * throwing on missing env config); this function only catches per-step errors.
 *
 * No secrets are ever logged — AppwriteException-shaped errors are summarised
 * as `{ phase, code, message }` before reaching `console.error`, mirroring the
 * schema provisioner (see shared/src/schema/provisioner.ts).
 */
import { Client, Databases, ID } from "node-appwrite";
import { DATABASE_ID, HEALTH_CHECK_COLLECTION_ID } from "../schema/declarations";

export type HealthStepStatus = "ok" | "failed";

export interface HealthStepResult {
  step: "create" | "read" | "delete";
  status: HealthStepStatus;
  durationMs: number;
  errorMessage?: string;
  errorCode?: number;
}

export interface HealthCheckResult {
  status: HealthStepStatus;
  steps: HealthStepResult[];
  documentId?: string;
  checkedAt: string;
}

/** Minimal AppwriteException-shaped view: `{ code, message }`. */
interface AppwriteExceptionLike {
  code?: unknown;
  message?: unknown;
}

// TODO(S2): adopt sanitizeAppwriteMessageForLog here once errorMessage/log
// separation is addressed — here `message` feeds BOTH the structured
// console.error log AND the returned HealthStepResult.errorMessage, so
// sanitizing it would alter the user-visible health-step result.
function describeError(err: unknown): { message: string; code?: number } {
  if (err && typeof err === "object") {
    const e = err as AppwriteExceptionLike;
    const code = typeof e.code === "number" ? e.code : undefined;
    const message = typeof e.message === "string" && e.message.length > 0 ? e.message : String(err);
    return { message, code };
  }
  return { message: String(err) };
}

export async function runHealthCheck(client: Client): Promise<HealthCheckResult> {
  const databases = new Databases(client);
  const steps: HealthStepResult[] = [];
  let documentId: string | undefined;
  let overallStatus: HealthStepStatus = "ok";
  const checkedAt = new Date().toISOString();

  // ----------------------------------------------------------- create ----
  {
    const start = performance.now();
    try {
      const doc = await databases.createDocument({
        databaseId: DATABASE_ID,
        collectionId: HEALTH_CHECK_COLLECTION_ID,
        documentId: ID.unique(),
        data: { status: "ok", createdAt: new Date().toISOString() },
      });
      documentId = doc.$id;
      steps.push({
        step: "create",
        status: "ok",
        durationMs: performance.now() - start,
      });
    } catch (err) {
      const { message, code } = describeError(err);
      console.error({ phase: "create", code, message });
      steps.push({
        step: "create",
        status: "failed",
        durationMs: performance.now() - start,
        errorMessage: message,
        errorCode: code,
      });
      overallStatus = "failed";
      return { status: overallStatus, steps, checkedAt };
    }
  }

  // ------------------------------------------------------------ read ----
  {
    const start = performance.now();
    try {
      await databases.getDocument({
        databaseId: DATABASE_ID,
        collectionId: HEALTH_CHECK_COLLECTION_ID,
        documentId: documentId!,
      });
      steps.push({
        step: "read",
        status: "ok",
        durationMs: performance.now() - start,
      });
    } catch (err) {
      const { message, code } = describeError(err);
      console.error({ phase: "read", code, message });
      steps.push({
        step: "read",
        status: "failed",
        durationMs: performance.now() - start,
        errorMessage: message,
        errorCode: code,
      });
      overallStatus = "failed";
      // C2: best-effort cleanup of the document created above so the
      // round-trip doesn't orphan a sentinel when read fails. Swallowed —
      // never logged loudly, never rendered as a stepper step. If this
      // delete also fails the document is left (V1-acceptable, same as the
      // delete-failure path below).
      try {
        await databases.deleteDocument({
          databaseId: DATABASE_ID,
          collectionId: HEALTH_CHECK_COLLECTION_ID,
          documentId: documentId!,
        });
      } catch (cleanupErr) {
        const { code, message } = describeError(cleanupErr);
        console.error({ phase: "cleanup-delete", code, message });
      }
      return { status: overallStatus, steps, documentId, checkedAt };
    }
  }

  // ----------------------------------------------------------- delete ----
  {
    const start = performance.now();
    try {
      await databases.deleteDocument({
        databaseId: DATABASE_ID,
        collectionId: HEALTH_CHECK_COLLECTION_ID,
        documentId: documentId!,
      });
      steps.push({
        step: "delete",
        status: "ok",
        durationMs: performance.now() - start,
      });
    } catch (err) {
      const { message, code } = describeError(err);
      console.error({ phase: "delete", code, message });
      steps.push({
        step: "delete",
        status: "failed",
        durationMs: performance.now() - start,
        errorMessage: message,
        errorCode: code,
      });
      overallStatus = "failed";
    }
  }

  return { status: overallStatus, steps, documentId, checkedAt };
}
