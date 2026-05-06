import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import {
  PW_BYPASS_COOKIE,
  playwrightRequestBypassesAuth,
} from "@/lib/playwright-bypass";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/config";

/** Forwarded on the request for RSC / layout so client components can match SSR. */
export const REQUEST_PATHNAME_HEADER = "x-pathname";

function requestHeadersWithPathname(request: NextRequest): Headers {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATHNAME_HEADER, request.nextUrl.pathname);
  return requestHeaders;
}

function withPlaywrightBypassCookie(response: NextResponse): NextResponse {
  response.cookies.set(PW_BYPASS_COOKIE, "1", {
    path: "/",
    maxAge: 60 * 60 * 24,
    sameSite: "lax",
    httpOnly: false,
  });
  return response;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: requestHeadersWithPathname(request),
    },
  });

  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({
            request: {
              headers: requestHeadersWithPathname(request),
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname === "/auth";
  const isApiRoute = pathname.startsWith("/api/");

  const bypassViaEnv = process.env.PLAYWRIGHT_BYPASS_AUTH === "true";
  const bypassViaDevHeader = playwrightRequestBypassesAuth(request.headers);

  if (bypassViaEnv || bypassViaDevHeader) {
    if (isAuthRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return withPlaywrightBypassCookie(NextResponse.redirect(url));
    }
    return withPlaywrightBypassCookie(response);
  }

  // getUser() validates JWT with Supabase Auth and fails when offline. Fall
  // back to cookie-backed getSession() so local-first flows keep working with a
  // non-expired access token (refresh still needs network once expired).
  let user = null;
  try {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    user = session?.user ?? null;
  }

  if (!user && !isAuthRoute && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
