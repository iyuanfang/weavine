"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { signInAction } from "@/app/(auth)/actions";
import { BRAND } from "@/lib/brand";
import { BrandMark } from "@/components/brand-mark";

export default function LoginPage() {
  const [state, action] = useFormState(signInAction, undefined);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <BrandMark className="h-6 w-[54px] text-accent" />
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          {BRAND.name}
        </h1>
        <p className="text-sm text-gray-500">{BRAND.slogan}</p>
        <p className="max-w-sm text-xs leading-relaxed text-gray-400">
          {BRAND.subtitle}
        </p>
      </div>

      <form action={action} className="flex w-full max-w-sm flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">邮箱</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600">密码</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <SubmitButton />
      </form>

      <p className="text-xs text-gray-500">
        还没有账号？{" "}
        <Link href="/sign-up" className="text-blue-600 hover:underline">
          注册新账号
        </Link>
      </p>
    </main>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
    >
      {pending ? "登录中…" : "登录"}
    </button>
  );
}
