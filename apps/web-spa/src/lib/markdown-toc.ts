// Shared markdown TOC parser used by both the local .md file editor
// (`MdEditor`) and the notes editor (`NoteDetail`). Returns the # / ## / ###
// headings found at the start of each line, skipping lines inside fenced
// code blocks so headings in code samples don't pollute the outline.
//
// Heading lines come back with a 0-indexed `line` number pointing into the
// original content, which the caller can map back to its own editor
// (textarea scrollTop math, or CodeMirror EditorView.scrollIntoView).

export interface TocHeading {
  level: 1 | 2 | 3;
  text: string;
  line: number;
}

export function parseTocHeadings(content: string): TocHeading[] {
  if (!content) return [];
  const lines = content.split('\n');
  const out: TocHeading[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (!m) continue;
    out.push({
      level: m[1].length as 1 | 2 | 3,
      text: m[2],
      line: i,
    });
  }
  return out;
}
