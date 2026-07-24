import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type Align = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

interface PopoverProps {
  anchorRef: React.RefObject<HTMLElement>;
  open: boolean;
  align?: Align;
  className?: string;
  style?: CSSProperties;
  onClose: () => void;
  children: ReactNode;
}

interface Pos {
  top: number;
  left: number;
}

const SCREEN_PADDING = 6;

export function Popover({
  anchorRef,
  open,
  align = 'bottom-start',
  className,
  style,
  onClose,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Pos>({ top: -9999, left: -9999 });
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    const a = anchorRef.current;
    const m = ref.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const mh = m?.offsetHeight ?? 240;
    const mw = m?.offsetWidth ?? 240;

    const wantTop = align === 'top-start' || align === 'top-end';
    const wantEnd = align === 'bottom-end' || align === 'top-end';

    const fitsBelow = r.bottom + 4 + mh < window.innerHeight - SCREEN_PADDING;
    const fitsAbove = r.top - 4 - mh > SCREEN_PADDING;

    const openOnTop = wantTop || (!fitsBelow && fitsAbove);
    const top = openOnTop ? r.top - 4 - mh : r.bottom + 4;

    let left = wantEnd ? r.right - mw : r.left;
    left = Math.max(
      SCREEN_PADDING,
      Math.min(left, window.innerWidth - mw - SCREEN_PADDING),
    );

    setPos({ top, left });
    setReady(true);

    const onResizeOrScroll = () => {
      const r2 = a.getBoundingClientRect();
      const fitsBelow2 = r2.bottom + 4 + mh < window.innerHeight - SCREEN_PADDING;
      const fitsAbove2 = r2.top - 4 - mh > SCREEN_PADDING;
      const openOnTop2 = wantTop || (!fitsBelow2 && fitsAbove2);
      const top2 = openOnTop2 ? r2.top - 4 - mh : r2.bottom + 4;
      let left2 = wantEnd ? r2.right - mw : r2.left;
      left2 = Math.max(
        SCREEN_PADDING,
        Math.min(left2, window.innerWidth - mw - SCREEN_PADDING),
      );
      setPos({ top: top2, left: left2 });
    };
    window.addEventListener('scroll', onResizeOrScroll, true);
    window.addEventListener('resize', onResizeOrScroll);
    return () => {
      window.removeEventListener('scroll', onResizeOrScroll, true);
      window.removeEventListener('resize', onResizeOrScroll);
    };
  }, [open, align, anchorRef, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const a = anchorRef.current;
      const m = ref.current;
      if (a?.contains(e.target as Node)) return;
      if (m?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={className}
      style={{
        position: 'fixed',
        top: ready ? pos.top : -9999,
        left: ready ? pos.left : -9999,
        zIndex: 9999,
        ...style,
      }}
      onMouseDown={(e: ReactMouseEvent) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
