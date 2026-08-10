import { NextResponse, type NextRequest } from "next/server";
import { isPublicRoute } from "./lib/auth/routes";

export function middleware(request: NextRequest) {
  if (isPublicRoute(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  // Check both the current cookie and the legacy variant; Appwrite may set
  // either depending on server/version configuration.
  const sessionCookie = projectId
    ? request.cookies.get(`a_session_${projectId}`)?.value
    : undefined;
  const legacyCookie = projectId
    ? request.cookies.get(`a_session_${projectId}_legacy`)?.value
    : undefined;

  const hasSession = Boolean(sessionCookie || legacyCookie);
  if (!hasSession) {
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
