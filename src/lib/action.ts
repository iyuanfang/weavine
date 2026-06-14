import { z } from 'zod';
import { ValidationError } from './errors';

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function runAction<TIn, TOut>(
  schema: z.ZodType<TIn>,
  formData: FormData,
  fn: (input: TIn) => Promise<TOut>
): Promise<ActionResult<TOut>> {
  const obj = Object.fromEntries(formData.entries());
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    return {
      ok: false,
      error: '校验失败',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    const data = await fn(parsed.data);
    return { ok: true, data };
  } catch (e: unknown) {
    if (e instanceof ValidationError) {
      return { ok: false, error: e.message, fieldErrors: e.issues as Record<string, string[]> };
    }
    const msg = e instanceof Error ? e.message : '未知错误';
    return { ok: false, error: msg };
  }
}
