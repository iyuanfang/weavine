'use client';

import { useEffect, useRef, useState } from 'react';
import { parseDateNL, toLocalDatetimeString } from '@/lib/date-parser';

function formatForDisplay(d: Date | null): string {
  if (!d) return '';
  return toLocalDatetimeString(d).replace('T', ' ');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateOnlyString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

export function DateTimeInput({
  name,
  value,
  onChange,
  label,
  placeholder = '明天下午3点',
  required = false,
  step = 900,
  showHelperText = true,
  defaultToNowOnOpen = true,
  helperText,
  size = 'md',
}: DateTimeInputProps) {
  const [text, setText] = useState<string>(formatForDisplay(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setText(formatForDisplay(value));
    }
  }, [value, isFocused]);

  function commitText() {
    const trimmed = text.trim();
    if (trimmed === '') {
      onChange(null);
      return;
    }
    const parsed = parseDateNL(trimmed);
    if (parsed) {
      onChange(parsed.date);
    } else {
      setText(formatForDisplay(value));
    }
  }

  function snapToStep(d: Date, stepSeconds: number): Date {
    const out = new Date(d);
    const stepMs = stepSeconds * 1000;
    out.setTime(Math.floor(out.getTime() / stepMs) * stepMs);
    out.setSeconds(0, 0);
    return out;
  }

  function setDatePart(dateStr: string) {
    if (!dateStr) {
      onChange(null);
      return;
    }
    const base = value ? new Date(value) : new Date();
    const [y, m, d] = dateStr.split('-').map(Number);
    base.setFullYear(y, m - 1, d);
    onChange(snapToStep(base, step));
  }

  function setHour(h: number) {
    const base = value ? new Date(value) : new Date();
    base.setHours(Math.max(0, Math.min(23, h)), base.getMinutes(), 0, 0);
    onChange(snapToStep(base, step));
  }

  function setMinute(m: number) {
    const base = value ? new Date(value) : new Date();
    base.setMinutes(Math.max(0, Math.min(59, m)), 0, 0);
    onChange(snapToStep(base, step));
  }

  function clear() {
    onChange(null);
  }

  function now() {
    onChange(snapToStep(new Date(), step));
  }

  const dateStr = value ? dateOnlyString(value) : '';
  const hour = value ? value.getHours() : '';
  const minute = value ? value.getMinutes() : '';

  const textInputClass =
    size === 'sm' ? 'input-sm flex-1 min-w-0' : 'input-base flex-1 min-w-0';
  const smallClass = size === 'sm' ? 'input-sm w-14' : 'input-base w-20';
  const dateClass = size === 'sm' ? 'input-sm w-28' : 'input-base w-40';
  const btnClass =
    size === 'sm'
      ? 'rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50'
      : 'rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50';

  return (
    <div>
      {label !== undefined && (
        <label className="text-sm font-medium">
          {label}
          {required ? ' *' : ''}
        </label>
      )}
      <div className={label !== undefined ? 'mt-1 flex flex-wrap items-center gap-2' : 'flex flex-wrap items-center gap-2'}>
        <input
          type="text"
          required={required}
          value={text}
          placeholder={placeholder}
          className={textInputClass}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setIsFocused(false);
            commitText();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitText();
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="自然语言日期时间"
        />
        <input
          type="date"
          required={required}
          value={dateStr}
          onChange={(e) => setDatePart(e.currentTarget.value)}
          className={dateClass}
          aria-label="选择日期"
        />
        <input
          type="number"
          min={0}
          max={23}
          value={hour}
          placeholder="HH"
          onChange={(e) => setHour(Number(e.currentTarget.value || 0))}
          className={smallClass}
          aria-label="小时"
        />
        <span className="text-gray-400">:</span>
        <input
          type="number"
          min={0}
          max={59}
          step={step / 60}
          value={minute}
          placeholder="MM"
          onChange={(e) => setMinute(Number(e.currentTarget.value || 0))}
          className={smallClass}
          aria-label="分钟"
        />
        {value ? (
          <button type="button" onClick={clear} className={btnClass} aria-label="清除">
            清空
          </button>
        ) : (
          !value && defaultToNowOnOpen && (
            <button type="button" onClick={now} className={btnClass} aria-label="使用当前时间">
              现在
            </button>
          )
        )}
        <input ref={undefined} type="hidden" name={name} value={value ? toLocalDatetimeString(value) : ''} />
      </div>
      {showHelperText && (
        <p className="mt-1 text-xs text-gray-500">
          {helperText ?? '支持自然语言（明天/后天/周X/上午X点），也可分别选日期、小时、分钟。'}
        </p>
      )}
    </div>
  );
}