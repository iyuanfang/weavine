import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const DEFAULT_TAGS = [
  { name: "朋友", color: "#10b981" },
  { name: "同事", color: "#3b82f6" },
  { name: "投资人", color: "#f59e0b" },
  { name: "客户", color: "#8b5cf6" },
  { name: "其他", color: "#6b7280" },
] as const;

async function ensureLocalUser(): Promise<{
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}> {
  console.error("[PRM-DIAG] ensureLocalUser start, DATABASE_URL:", process.env.DATABASE_URL);
  const user = await prisma.user.upsert({
    where: { email: "local@prm.local" },
    create: {
      name: "本地用户",
      email: "local@prm.local",
      isLocal: true,
    },
    update: {},
    select: { id: true, name: true, email: true },
  });
  console.error("[PRM-DIAG] user upserted, id:", user.id, "name:", user.name);
  const existingCount = await prisma.tag.count({
    where: { ownerId: user.id },
  });
  console.error("[PRM-DIAG] existing tag count:", existingCount);
  if (existingCount === 0) {
    try {
      await prisma.tag.createMany({
        data: DEFAULT_TAGS.map((t) => ({ ...t, ownerId: user.id })),
      });
      console.error("[PRM-DIAG] tags created successfully");
    } catch (e) {
      console.error("[PRM-DIAG] tag createMany failed:", e instanceof Error ? e.message : String(e));
      console.error("[PRM-DIAG] tag createMany stack:", e instanceof Error ? e.stack : "no stack");
      // Concurrent request already seeded tags — harmless
    }
  }
  const afterCount = await prisma.tag.count({
    where: { ownerId: user.id },
  });
  console.error("[PRM-DIAG] tag count after ensure:", afterCount);
  return { id: user.id, name: user.name, email: user.email, image: null };
}

export const getCurrentUser = cache(async () => {
  if (process.env.IS_DESKTOP === "true") {
    return ensureLocalUser();
  }
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
