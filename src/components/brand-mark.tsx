import { BRAND } from '@/lib/brand';
import type { SVGProps } from 'react';

type BrandMarkProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  title?: string;
};

export function BrandMark({
  className,
  title,
  'aria-hidden': ariaHidden,
  'aria-label': ariaLabel,
  ...rest
}: BrandMarkProps) {
  const isHidden = ariaHidden === true || ariaHidden === 'true';
  const accessibleLabel = ariaLabel ?? title ?? BRAND.name;

  return (
    <svg
      viewBox="0 0 36 16"
      role={isHidden ? undefined : 'img'}
      aria-label={isHidden ? undefined : accessibleLabel}
      aria-hidden={ariaHidden}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      <circle cx="4" cy="8" r="3" fill="currentColor" stroke="none" />
      <line x1="8" y1="8" x2="22" y2="8" strokeDasharray="2.5 2.5" />
      <polyline points="22,8 27,12 33,4" />
    </svg>
  );
}
