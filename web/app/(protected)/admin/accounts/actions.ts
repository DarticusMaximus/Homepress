"use server";

import { revalidatePath } from "next/cache";
import { Users } from "node-appwrite";
import { getServerAppwrite } from "@newsletter/shared";
import {
  AccountAdminError,
  createReaderAccount,
  deleteAccount,
  resetAccountPassword,
  setAccountBlocked,
} from "@/lib/accounts/account-admin";
import { ForbiddenError, requireOperator } from "@/lib/auth/require-operator";
import { UnauthorizedError } from "@/lib/auth/require-user";

export type AccountActionResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

async function runAccountAction(fn: () => Promise<void>): Promise<AccountActionResult> {
  try {
    await fn();
    revalidatePath("/admin/accounts");
    return { ok: true };
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
      throw err;
    }
    if (err instanceof AccountAdminError) {
      return { ok: false, error: err.message };
    }
    console.error("[accounts]", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

function usersClient(): Users {
  return new Users(getServerAppwrite());
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function createReaderAccountAction(
  _prev: AccountActionResult | null,
  formData: FormData,
): Promise<AccountActionResult> {
  await requireOperator();
  const name = formData.get("name");
  const email = formData.get("email");
  const password = formData.get("password");

  return runAccountAction(async () => {
    await createReaderAccount(usersClient(), {
      name: typeof name === "string" ? name : undefined,
      email: typeof email === "string" ? email : "",
      password: typeof password === "string" ? password : "",
    });
  });
}

export async function setAccountBlockedAction(
  _prev: AccountActionResult | null,
  formData: FormData,
): Promise<AccountActionResult> {
  await requireOperator();
  const userId = formString(formData, "userId");
  const blocked = formData.get("blocked") === "true";

  return runAccountAction(async () => {
    await setAccountBlocked(usersClient(), userId, blocked);
  });
}

export async function resetReaderPasswordAction(
  _prev: AccountActionResult | null,
  formData: FormData,
): Promise<AccountActionResult> {
  await requireOperator();
  const userId = formString(formData, "userId");
  const password = formString(formData, "password");

  return runAccountAction(async () => {
    await resetAccountPassword(usersClient(), userId, password);
  });
}

export async function deleteReaderAccountAction(
  _prev: AccountActionResult | null,
  formData: FormData,
): Promise<AccountActionResult> {
  await requireOperator();
  const userId = formString(formData, "userId");

  return runAccountAction(async () => {
    await deleteAccount(usersClient(), userId);
  });
}
