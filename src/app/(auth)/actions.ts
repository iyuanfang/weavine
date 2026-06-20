"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/auth";

const credentialsSchema = z.object({
  email: z.string().email().max(200).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8).max(200),
});

export type AuthFormState = { error?: string } | undefined;

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "请检查邮箱和密码" };
  }
  const { email, password } = parsed.data;
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) return { error: "该邮箱已注册" };

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, name: email.split("@")[0] },
    select: { id: true },
  });

  await prisma.tag.createMany({
    data: [
      { ownerId: user.id, name: "朋友", color: "#10b981" },
      { ownerId: user.id, name: "同事", color: "#3b82f6" },
      { ownerId: user.id, name: "投资人", color: "#f59e0b" },
      { ownerId: user.id, name: "客户", color: "#8b5cf6" },
      { ownerId: user.id, name: "其他", color: "#6b7280" },
    ],
  });

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/today",
    });
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: "注册后自动登录失败，请手动登录" };
  }
  return undefined;
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "请检查邮箱和密码" };
  }
  const { email, password } = parsed.data;
  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/today",
    });
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: "邮箱或密码错误" };
  }
  return undefined;
}

export async function signOutAction() {
  const { signOut } = await import("@/auth");
  await signOut({ redirectTo: "/login" });
  redirect("/login");
}
