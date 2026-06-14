function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export interface TagColor {
  bg: string;
  text: string;
  border: string;
}

/**
 * Deterministic HSL color from tag name.
 * Saturation 50-70%, lightness 35-75% → guaranteed readable with contrast text.
 */
export function tagColor(name: string): TagColor {
  const hash = hashString(name);
  const hue = hash % 360;
  const saturation = 50 + (hash % 20);
  const lightness = 35 + (hash % 40);
  const bg = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  const text = lightness > 55 ? '#111827' : '#f9fafb';
  const border = `hsl(${hue}, ${saturation}%, ${Math.max(lightness - 10, 15)}%)`;
  return { bg, text, border };
}
