function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    const cjk = trimmed.match(/[\u4e00-\u9fff]/g);
    if (cjk && cjk.length >= 2) return cjk.slice(0, 2).join('');
    if (cjk) return cjk[0];
    return trimmed.slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarStyle(name: string): { bg: string; text: string } {
  const h = djb2(name);
  const hue = h % 360;
  const sat = 55 + (h % 25);
  const light = 55 + ((h >> 8) % 15);
  const bg = `hsl(${hue}, ${sat}%, ${light}%)`;
  const text = light > 60 ? '#111827' : '#f9fafb';
  return { bg, text };
}
