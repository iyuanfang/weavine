import { useEffect, useState } from 'react';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: number;
  title?: string;
}

function initials(name: string): string {
  const cleaned = (name ?? '').trim();
  if (!cleaned) return '?';
  const chars = Array.from(cleaned);
  if (chars.length >= 2) return (chars[0] + chars[1]).toUpperCase();
  return chars[0].toUpperCase();
}

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

export function Avatar({ src, name, size = 40, title }: AvatarProps) {
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [src]);
  const showImage = !!src && !errored;
  return (
    <span
      title={title ?? name}
      aria-label={name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: colorFor(name),
        color: '#fff',
        fontWeight: 600,
        fontSize: Math.max(10, Math.round(size * 0.4)),
        overflow: 'hidden',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {showImage ? (
        <img key={src}
          src={src ?? ''}
          alt={name}
          onError={() => setErrored(true)}
          onLoad={() => setErrored(false)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}