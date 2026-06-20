"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { signUpAction } from "@/app/(auth)/actions";

export default function SignUpPage() {
  const [state, action] = useFormState(signUpAction, undefined);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">注册 PRM</h1>
        <p className="mt-2 text-sm text-gray-500">用邮箱创建账号</p>
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
          <span className="text-gray-600">密码（至少 8 位）</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <SubmitButton />
      </form>

      <p className="text-xs text-gray-500">
        已有账号？{" "}
        <Link href="/login" className="text-blue-600 hover:underline">
          直接登录
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
      {pending ? "注册中…" : "注册"}
    </button>
  );
}
