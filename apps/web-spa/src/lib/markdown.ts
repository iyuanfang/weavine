import MarkdownIt from 'markdown-it';
import markdownItMark from 'markdown-it-mark';
// Multimd-table supports GFM | col | col | syntax as well as MultiMarkdown
// =-row alignment. It's the most maintained markdown-it table plugin and
// matches what GitHub / Obsidian / Typora / VS Code render.
import markdownItMultimdTable from 'markdown-it-multimd-table';
// GFM task lists: `- [ ]` and `- [x]` render as <input type=checkbox>.
// markdown-it-task-lists is the maintained fork that supports enabled:false
// (read-only checkbox in rendered HTML).
// GFM task lists: `- [ ]` and `- [x]` → <input type=checkbox disabled>.
// enabled:false is required so the rendered preview is read-only (notes
// are only edited from the CodeMirror side).
import markdownItTaskLists from 'markdown-it-task-lists';

export type WikilinkTarget = 'contact' | 'project' | 'action' | 'event' | 'interaction';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
})
  .use(markdownItMark)
  .use(markdownItMultimdTable, {
    // multiline: true is GFM (pipe-table allows line breaks inside cells)
    multiline: false,
    rowspan: false,
    headerless: false,
  })
  .use(markdownItTaskLists, { enabled: false });

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