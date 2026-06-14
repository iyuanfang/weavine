import { initials, avatarStyle } from '@/lib/avatar';

export function Avatar({
  name,
  size = 40,
  src,
}: {
  name: string;
  size?: number;
  src?: string | null;
}) {
  const style = avatarStyle(name);
  const px = `${size}px`;
  const fontSize = size <= 32 ? size * 0.4 : size * 0.42;
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        style={{ width: px, height: px }}
        className="rounded-full object-cover"
      />
    );
  }
  return (
    <div
      style={{
        width: px,
        height: px,
        background: style.bg,
        color: style.text,
        fontSize: `${fontSize}px`,
        lineHeight: 1,
      }}
      className="inline-flex items-center justify-center rounded-full font-semibold"
    >
      {initials(name)}
    </div>
  );
}
