import NextAuth from "next-auth";
import authConfig from "@/auth.config";

/**
 * Edge middleware. This is the only place we export the Auth.js auth handler
 * as middleware. The `authorized` callback in authConfig decides redirects.
 */
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Run on every path except static assets and the auth API itself.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|sw.js|manifest.json).*)"],
};
