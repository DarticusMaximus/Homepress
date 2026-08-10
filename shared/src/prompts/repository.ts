import { Client, Databases } from "node-appwrite";
import { DATABASE_ID, PROMPT_TEMPLATES_COLLECTION_ID } from "../schema/declarations";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";
import { validatePromptTemplate } from "./contract";
import { SHIPPED_PROMPT_DEFAULTS } from "./defaults";
import {
  PROMPT_ROLES,
  PromptRepositoryError,
  type PromptRole,
  type PromptTemplate,
  type UpdatePromptTemplateResult,
} from "./types";

const APPWRITE_SAFE_MESSAGE =
  "Something went wrong while talking to the database. Please try again.";

interface AppwriteExceptionLike {
  code?: unknown;
  message?: unknown;
}

function describeError(err: unknown): { message: string; code?: number } {
  if (err && typeof err === "object") {
    const e = err as AppwriteExceptionLike;
    const code = typeof e.code === "number" ? e.code : undefined;
    const message = typeof e.message === "string" && e.message.length > 0 ? e.message : String(err);
    return { message, code };
  }
  return { message: String(err) };
}

function wrapAppwriteError(err: unknown, phase: string): never {
  const { message, code } = describeError(err);
  console.error({ phase, code, message: sanitizeAppwriteMessageForLog(message) });
  throw new PromptRepositoryError("appwrite", APPWRITE_SAFE_MESSAGE);
}

function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as AppwriteExceptionLike).code === 404;
}

function isConflict(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as AppwriteExceptionLike).code === 409;
}

function assertPromptRole(role: string): asserts role is PromptRole {
  if (!(PROMPT_ROLES as readonly string[]).includes(role)) {
    throw new PromptRepositoryError(
      "validation",
      `Invalid prompt role: ${role}. Expected one of: ${PROMPT_ROLES.join(", ")}`,
    );
  }
}

function documentToTemplate(role: PromptRole, doc: Record<string, unknown>): PromptTemplate {
  return {
    role,
    body: typeof doc.body === "string" ? doc.body : "",
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : "",
  };
}

export async function getOrCreatePromptTemplate(
  client: Client,
  role: PromptRole,
): Promise<PromptTemplate> {
  assertPromptRole(role);
  const databases = new Databases(client);

  try {
    const doc = await databases.getDocument({
      databaseId: DATABASE_ID,
      collectionId: PROMPT_TEMPLATES_COLLECTION_ID,
      documentId: role,
    });
    return documentToTemplate(role, doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof PromptRepositoryError) throw err;
    if (isNotFound(err)) {
      const now = new Date().toISOString();
      const data = {
        body: SHIPPED_PROMPT_DEFAULTS[role],
        updatedAt: now,
      };
      try {
        const doc = await databases.createDocument({
          databaseId: DATABASE_ID,
          collectionId: PROMPT_TEMPLATES_COLLECTION_ID,
          documentId: role,
          data,
        });
        return documentToTemplate(role, doc as unknown as Record<string, unknown>);
      } catch (err2) {
        if (err2 instanceof PromptRepositoryError) throw err2;
        if (isConflict(err2)) {
          try {
            const doc = await databases.getDocument({
              databaseId: DATABASE_ID,
              collectionId: PROMPT_TEMPLATES_COLLECTION_ID,
              documentId: role,
            });
            return documentToTemplate(role, doc as unknown as Record<string, unknown>);
          } catch (err3) {
            if (err3 instanceof PromptRepositoryError) throw err3;
            wrapAppwriteError(err3, "get-prompt-template-after-race");
          }
        }
        wrapAppwriteError(err2, "create-prompt-template");
      }
    }
    wrapAppwriteError(err, "get-prompt-template");
  }
}

export async function listPromptTemplates(client: Client): Promise<PromptTemplate[]> {
  const templates: PromptTemplate[] = [];
  for (const role of PROMPT_ROLES) {
    templates.push(await getOrCreatePromptTemplate(client, role));
  }
  return templates;
}

export async function updatePromptTemplate(
  client: Client,
  role: PromptRole,
  body: string,
): Promise<UpdatePromptTemplateResult> {
  assertPromptRole(role);

  const validation = validatePromptTemplate(role, body);
  if (!validation.ok) {
    const missing = validation.missing.join(", ");
    throw new PromptRepositoryError(
      "validation",
      `Missing required placeholders: ${missing}`,
    );
  }

  await getOrCreatePromptTemplate(client, role);

  const databases = new Databases(client);
  const now = new Date().toISOString();
  const data = {
    body,
    updatedAt: now,
  };

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: PROMPT_TEMPLATES_COLLECTION_ID,
      documentId: role,
      data,
    });
    return {
      template: documentToTemplate(role, doc as unknown as Record<string, unknown>),
      warnings: validation.warnings,
    };
  } catch (err) {
    if (err instanceof PromptRepositoryError) throw err;
    wrapAppwriteError(err, "update-prompt-template");
  }
}

export async function resetPromptTemplate(
  client: Client,
  role: PromptRole,
): Promise<UpdatePromptTemplateResult> {
  assertPromptRole(role);
  return updatePromptTemplate(client, role, SHIPPED_PROMPT_DEFAULTS[role]);
}
