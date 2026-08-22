/**
 * Deterministic contact-avatar background, hashed from display name so the
 * same person always looks the same across lists / detail / search.
 *
 * Six palettes picked for hue spread (cool→warm). When tweaking: keep distinct
 * lightness/saturation so contacts don't blur together when shown side-by-side.
 */
const PALETTES = [
  'linear-gradient(135deg, #6366f1, #3b82f6)', // indigo → blue
  'linear-gradient(135deg, #ec4899, #f43f5e)', // pink → rose
  'linear-gradient(135deg, #10b981, #14b8a6)', // emerald → teal
  'linear-gradient(135deg, #f59e0b, #ef4444)', // amber → red
  'linear-gradient(135deg, #8b5cf6, #6366f1)', // violet → indigo
  'linear-gradient(135deg, #06b6d4, #3b82f6)', // cyan → blue
];

export function avatarBg(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return PALETTES[Math.abs(hash) % PALETTES.length];
}
