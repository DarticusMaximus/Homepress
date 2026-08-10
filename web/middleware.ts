import { NextResponse, type NextRequest } from "next/server";
import { isPublicRoute } from "./lib/auth/routes";

/** True if any Appwrite session cookie is present (project-id-agnostic). */
function hasAppwriteSessionCookie(request: NextRequest): boolean {
  for (const { name, value } of request.cookies.getAll()) {
    if (name.startsWith("a_session_") && value) {
      return true;
    }
  }
  return false;
}

export function middleware(request: NextRequest) {
  if (isPublicRoute(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // Do not read NEXT_PUBLIC_* here — Edge middleware may bake env at build time.
  // Cookie name is `a_session_<projectId>`; scanning the prefix keeps prebuilt
  // images working with any Appwrite project from runtime .env.
  if (!hasAppwriteSessionCookie(request)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|xml|webmanifest|map)$).*)",
  ],
};
