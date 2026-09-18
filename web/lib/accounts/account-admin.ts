import { ID, Query, type Users } from "node-appwrite";
import { isOperator } from "@/lib/auth/require-operator";

export type AccountAdminErrorCode = "validation" | "not_found" | "forbidden_target" | "appwrite";

/**
 * Domain error for household account operations. `code` is the stable
 * discriminator; `message` is always a fixed safe string — never Appwrite
 * internals.
 */
export class AccountAdminError extends Error {
  readonly code: AccountAdminErrorCode;

  constructor(code: AccountAdminErrorCode, message: string) {
    super(message);
    this.name = "AccountAdminError";
    this.code = code;
  }
}

export type AccountRole = "operator" | "reader";
export type AccountStatus = "active" | "blocked";

export type AccountRecord = {
  id: string;
  name: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  registered: string;
};

export type CreateReaderAccountInput = {
  name?: string;
  email: string;
  password: string;
};

const EMAIL_MESSAGE = "Enter a valid email address";
const PASSWORD_MESSAGE = "Password must be at least 8 characters";
const ALREADY_EXISTS_MESSAGE = "An account with this email already exists";
const NOT_FOUND_MESSAGE = "Account not found";
const FORBIDDEN_MESSAGE = "Operator accounts cannot be blocked, reset, or deleted";
const APPWRITE_SAFE_MESSAGE = "Something went wrong while updating accounts. Please try again.";

const MIN_PASSWORD_LENGTH = 8;

/** Appwrite Users.list default is 25; paginate in chunks of 100 (SDK max). */
export const ACCOUNT_LIST_PAGE_SIZE = 100;

interface AppwriteExceptionLike {
  code?: unknown;
  type?: unknown;
}

type UserLike = {
  $id: string;
  name?: string;
  email?: string;
  labels?: string[];
  status?: boolean;
  $createdAt: string;
};

function wrapAppwriteError(err: unknown, phase: string): never {
  const code = err && typeof err === "object" ? (err as AppwriteExceptionLike).code : undefined;
  console.error({ phase, code });
  throw new AccountAdminError("appwrite", APPWRITE_SAFE_MESSAGE);
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as AppwriteExceptionLike).code === 404);
}

function isDuplicateEmailError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as AppwriteExceptionLike;
  return e.code === 409 || e.type === "user_already_exists";
}

function validateEmail(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AccountAdminError("validation", EMAIL_MESSAGE);
  }
  const email = raw.trim();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) {
    throw new AccountAdminError("validation", EMAIL_MESSAGE);
  }
  const domain = email.slice(at + 1);
  if (
    email.includes(" ") ||
    !domain.includes(".") ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..")
  ) {
    throw new AccountAdminError("validation", EMAIL_MESSAGE);
  }
  return email;
}

function validatePassword(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < MIN_PASSWORD_LENGTH) {
    throw new AccountAdminError("validation", PASSWORD_MESSAGE);
  }
  return raw;
}

function optionalName(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    throw new AccountAdminError("validation", "Name must be a string");
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toAccountRecord(user: UserLike): AccountRecord {
  return {
    id: user.$id,
    name: user.name ?? "",
    email: user.email ?? "",
    role: isOperator(user) ? "operator" : "reader",
    status: user.status === false ? "blocked" : "active",
    registered: user.$createdAt,
  };
}

async function fetchTarget(users: Users, userId: string): Promise<UserLike> {
  try {
    return await users.get({ userId });
  } catch (err) {
    if (err instanceof AccountAdminError) throw err;
    if (isNotFound(err)) {
      throw new AccountAdminError("not_found", NOT_FOUND_MESSAGE);
    }
    wrapAppwriteError(err, "get-account");
  }
}

function assertMutableTarget(user: UserLike): void {
  if (isOperator(user)) {
    throw new AccountAdminError("forbidden_target", FORBIDDEN_MESSAGE);
  }
}

export async function listAccounts(users: Users): Promise<AccountRecord[]> {
  try {
    const all: AccountRecord[] = [];
    let cursorId: string | null = null;

    for (;;) {
      const queries: string[] = [Query.limit(ACCOUNT_LIST_PAGE_SIZE)];
      if (cursorId) {
        queries.push(Query.cursorAfter(cursorId));
      }
      const result = await users.list({ queries });
      const page = result.users;
      all.push(...page.map((user) => toAccountRecord(user)));

      if (page.length === 0) break;
      if (typeof result.total === "number" && all.length >= result.total) break;
      if (page.length < ACCOUNT_LIST_PAGE_SIZE) break;
      cursorId = page[page.length - 1]!.$id;
    }
    return all;
  } catch (err) {
    if (err instanceof AccountAdminError) throw err;
    wrapAppwriteError(err, "list-accounts");
  }
}

export async function createReaderAccount(
  users: Users,
  input: CreateReaderAccountInput,
): Promise<AccountRecord> {
  const email = validateEmail(input.email);
  const password = validatePassword(input.password);
  const name = optionalName(input.name);

  const payload: {
    userId: string;
    email: string;
    password: string;
    name?: string;
  } = {
    userId: ID.unique(),
    email,
    password,
  };
  if (name !== undefined) {
    payload.name = name;
  }

  try {
    const created = await users.create(payload);
    return toAccountRecord(created);
  } catch (err) {
    if (err instanceof AccountAdminError) throw err;
    if (isDuplicateEmailError(err)) {
      throw new AccountAdminError("validation", ALREADY_EXISTS_MESSAGE);
    }
    wrapAppwriteError(err, "create-reader");
  }
}

export async function setAccountBlocked(
  users: Users,
  userId: string,
  blocked: boolean,
): Promise<AccountRecord> {
  const target = await fetchTarget(users, userId);
  assertMutableTarget(target);

  try {
    const updated = await users.updateStatus({ userId, status: !blocked });
    return toAccountRecord(updated);
  } catch (err) {
    if (err instanceof AccountAdminError) throw err;
    wrapAppwriteError(err, "set-account-blocked");
  }
}

export async function resetAccountPassword(
  users: Users,
  userId: string,
  password: string,
): Promise<AccountRecord> {
  const nextPassword = validatePassword(password);
  const target = await fetchTarget(users, userId);
  assertMutableTarget(target);

  try {
    const updated = await users.updatePassword({ userId, password: nextPassword });
    return toAccountRecord(updated);
  } catch (err) {
    if (err instanceof AccountAdminError) throw err;
    wrapAppwriteError(err, "reset-account-password");
  }
}

export async function deleteAccount(users: Users, userId: string): Promise<void> {
  const target = await fetchTarget(users, userId);
  assertMutableTarget(target);

  try {
    await users.delete({ userId });
  } catch (err) {
    if (err instanceof AccountAdminError) throw err;
    wrapAppwriteError(err, "delete-account");
  }
}
