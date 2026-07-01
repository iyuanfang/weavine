export const runtime = "nodejs";

export async function register() {
  if (process.env.IS_DESKTOP !== "true") return;
  // Pre-warm Prisma engine + local user at server start so the first
  // page render is not blocked by engine init. Without this, every
  // app launch pays a 2-4s Prisma cold start on the first query.
  const { initializeDesktopUser } = await import("@/lib/auth/session");
  initializeDesktopUser().catch((e) => {
    console.error("[instrumentation] initializeDesktopUser failed:", e);
  });
}
