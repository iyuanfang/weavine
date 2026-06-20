import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * Data Access Layer for the current user.
 * - React.cache() de-duplicates per request, so multiple `getCurrentUser()`
 *   calls in a single render don't re-read the JWT.
 * - Use in server components, server actions, and route handlers.
 * - Throws `redirect("/login")` if there's no session.
 */
export const getCurrentUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return {
    id: session.user.id,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
    email: session.user.email ?? null,
  };
});

export type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;
