import MarkdownIt from 'markdown-it';

export type WikilinkTarget = 'contact' | 'project' | 'action' | 'event' | 'interaction';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

md.inline.ruler.after('emphasis', 'wikilink', (state, silent) => {
  const start = state.pos;
  const src = state.src;
  if (src.charCodeAt(start) !== 0x5b /* [ */ || src.charCodeAt(start + 1) !== 0x5b) {
    return false;
  }
  const end = src.indexOf(']]', start + 2);
  if (end < 0) return false;
  const inner = src.slice(start + 2, end);
  const colon = inner.indexOf(':');
  if (colon < 1) return false;
  const kind = inner.slice(0, colon).toLowerCase();
  if (!['contact', 'project', 'action', 'event', 'interaction'].includes(kind)) return false;
  const title = inner.slice(colon + 1).trim();
  if (!title) return false;
  if (!silent) {
    const token = state.push('wikilink_open', 'a', 1);
    const href = kind === 'contact' ? 'contacts'
      : kind === 'project' ? 'projects'
      : kind === 'action' ? 'actions'
      : kind === 'event' ? 'events'
      : 'interactions';
    token.attrs = [
      ['class', 'wikilink'],
      ['data-wikilink-kind', kind],
      ['data-wikilink-title', title],
      ['href', `#/${href}`],
    ];
    const text = state.push('text', '', 0);
    text.content = `${kind}:${title}`;
    state.push('wikilink_close', 'a', -1);
  }
  state.pos = end + 2;
  return true;
});

export function renderMarkdown(body: string): string {
  return md.render(body ?? '');
}

export function extractWikilinks(body: string): Array<{ kind: WikilinkTarget; title: string }> {
  const out: Array<{ kind: WikilinkTarget; title: string }> = [];
  const re = /\[\[(contact|project|action|event|interaction):([^\]]+?)\]\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const kind = m[1].toLowerCase() as WikilinkTarget;
    const title = m[2].trim();
    if (title) out.push({ kind, title });
  }
  return out;
}