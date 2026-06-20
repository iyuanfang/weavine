'use client';

import { useId } from 'react';

export interface DatalistOption {
  value: string;
  label?: string;
}

export interface DatalistInputProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: DatalistOption[];
  placeholder?: string;
  required?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * Free-text input that suggests options from a datalist.
 * Built-in options are suggestions, not constraints — user can type any value.
 */
export function DatalistInput({
  name,
  value,
  onChange,
  options,
  placeholder,
  required,
  className,
  size = 'md',
}: DatalistInputProps) {
  const autoId = useId();
  const listId = `datalist-${autoId}`;
  const baseClass = size === 'sm' ? 'input-sm' : 'input-base';
  const finalClass = className ?? `${baseClass} w-full`;

  return (
    <>
      <input
        type="text"
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        list={listId}
        className={finalClass}
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label ?? opt.value}
          </option>
        ))}
      </datalist>
    </>
  );
}