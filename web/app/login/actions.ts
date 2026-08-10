/*
 * Architecture decision: all Appwrite access in this project is server-side
 * via `node-appwrite` (server components / server actions). The browser
 * Appwrite SDK was intentionally removed (see
 * `.ssc/reviews/review-stage-00-scaffolding-2026-06-30`, finding M1).
 *
 * If a future stage genuinely needs browser-side Appwrite (e.g. realtime
 * subscriptions or resumable uploads), reintroduce it deliberately at that
 * point, authenticating via an in-memory `setSession(secret)` minted
 * server-side from the first-party session cookie (`a_session_<projectId>`).
 * Never wire login through the browser SDK.
 */
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Account, Client } from "node-appwrite";
import {
  getAppwriteEndpoint,
  getAppwriteProjectId,
  getServerAppwrite,
} from "@newsletter/shared";
import { extractSessionSecret } from "@/lib/auth/session";
import { mapLoginError } from "@/lib/auth/login-errors";

export type LoginState = { error: string | null; success?: true };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = (formData.get("email") as string | null)?.trim() ?? "";
  const password = (formData.get("password") as string | null)?.trim() ?? "";

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const projectId = getAppwriteProjectId();
  if (!projectId) {
    return { error: "Server is missing Appwrite configuration" };
  }

  try {
    const client = getServerAppwrite();
    const account = new Account(client);
    const session = await account.createEmailPasswordSession(email, password);

    const secret = session.secret;
    if (!secret) {
      return { error: "Login failed: no session secret returned" };
    }

    let maxAge = 60 * 60 * 24 * 30;
    if (session.expire) {
      const ms = new Date(session.expire).getTime() - Date.now();
      if (!Number.isNaN(ms)) {
        maxAge = Math.max(0, Math.floor(ms / 1000));
      }
    }

    const cookieStore = await cookies();
    cookieStore.set(`a_session_${projectId}`, secret, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge,
    });

    return { error: null, success: true };
  } catch (err) {
    console.error("[login] failed:", err);
    return { error: mapLoginError(err) };
  }
}

export async function logoutAction(): Promise<void> {
  const projectId = getAppwriteProjectId();
  const endpoint = getAppwriteEndpoint();

  const cookieStore = await cookies();
  const raw = projectId ? cookieStore.get(`a_session_${projectId}`)?.value : undefined;
  const secret = extractSessionSecret(raw);

  if (secret && endpoint && projectId) {
    try {
      const client = new Client().setEndpoint(endpoint).setProject(projectId).setSession(secret);
      const account = new Account(client);
      await account.deleteSession("current");
    } catch {
      // Best-effort: clear the cookie regardless.
    }
  }

  if (projectId) {
    cookieStore.set(`a_session_${projectId}`, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
    });
  }

  redirect("/login");
}
