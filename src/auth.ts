import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import authConfig from "./auth.config";

/**
 * Full Auth.js v5 setup with Prisma adapter.
 * - JWT strategy: works with edge middleware (no DB roundtrip per request).
 * - Credentials provider wired in `auth.config.ts`.
 * - Name/image stored in JWT at sign-in to avoid DB query on every page load.
 */
export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.name = user.name;
        token.picture = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
        session.user.name = (token.name as string | null) ?? session.user.name ?? null;
        session.user.image = (token.picture as string | null) ?? session.user.image ?? null;
      }
      return session;
    },
  },
});
