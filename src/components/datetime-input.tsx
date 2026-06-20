'use client';

import { useEffect, useRef, useState } from 'react';
import { parseDateNL, toLocalDatetimeString } from '@/lib/date-parser';

function formatForDisplay(d: Date | null): string {
  if (!d) return '';
  return toLocalDatetimeString(d).replace('T', ' ');
}

export interface DateTimeInputProps {
  name: string;
  value: Date | null;
  onChange: (date: Date | null) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  step?: number;
  showHelperText?: boolean;
  defaultToNowOnOpen?: boolean;
  helperText?: string;
  size?: 'sm' | 'md';
}

/**
 * 合并"自然语言输入"与"原生 datetime-local 选择器"的日期时间输入控件。
 *
 * 用法：
 *   const [startAt, setStartAt] = useState<Date | null>(null);
 *   <DateTimeInput name="startAt" value={startAt} onChange={setStartAt} required />
 *
 * - 文本框支持中文/英文自然语言（"明天下午3点"、"next monday 10am" 等），
 *   解析成功自动回填并触发 onChange。
 * - 点击右侧日历图标弹出原生 picker；若当前为空，预填"现在（分钟对齐 step）"。
 * - picker 选择后 onChange 触发，且文本框同步显示格式化值。
 * - 隐藏的 datetime-local 携带 name 属性，表单提交时 FormData 自动带上。
 */
export function DateTimeInput({
  name,
  value,
  onChange,
  label,
  placeholder = '明天下午3点 / 2026-06-20 14:00',
  required = false,
  step = 900,
  showHelperText = true,
  defaultToNowOnOpen = true,
  helperText,
  size = 'md',
}: DateTimeInputProps) {
  const [text, setText] = useState<string>(formatForDisplay(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(formatForDisplay(value));
  }, [value]);

  function snapToStep(d: Date, stepSeconds: number): Date {
    const out = new Date(d);
    const stepMs = stepSeconds * 1000;
    out.setTime(Math.floor(out.getTime() / stepMs) * stepMs);
    out.setSeconds(0, 0);
    return out;
  }

  function openPicker() {
    const el = pickerRef.current;
    if (!el) return;
    if (!value && defaultToNowOnOpen) {
      onChange(snapToStep(new Date(), step));
    }
    if (typeof el.showPicker === 'function') {
      el.showPicker();
    } else {
      el.focus();
      el.click();
    }
  }

  const inputClass = size === 'sm' ? 'input-sm w-full pr-10' : 'input-base w-full pr-12';
  const buttonClass =
    size === 'sm'
      ? 'absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      : 'absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700';
  const iconClass = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';

  return (
    <div>
      {label !== undefined && (
        <label className="text-sm font-medium">
          {label}
          {required ? ' *' : ''}
        </label>
      )}
      <div className={label !== undefined ? 'relative mt-1' : 'relative'}>
        <input
          type="text"
          required={required}
          value={text}
          placeholder={placeholder}
          className={inputClass}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            const parsed = parseDateNL(v);
            if (parsed) {
              onChange(parsed.date);
            } else if (v.trim() === '') {
              onChange(null);
            }
          }}
        />
        <button
          type="button"
          onClick={openPicker}
          className={buttonClass}
          title="打开日期时间选择器"
          aria-label="打开日期时间选择器"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={iconClass}
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
        <input
          ref={pickerRef}
          type="datetime-local"
          name={name}
          step={step}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          value={value ? toLocalDatetimeString(value) : ''}
          onChange={(e) => {
            const v = e.currentTarget.value;
            onChange(v ? new Date(v) : null);
          }}
        />
      </div>
      {showHelperText && (
        <p className="mt-1 text-xs text-gray-500">
          {helperText ?? '支持自然语言（明天/后天/周X/上午X点），也可点右侧日历图标直接选时间。'}
        </p>
      )}
    </div>
  );
}