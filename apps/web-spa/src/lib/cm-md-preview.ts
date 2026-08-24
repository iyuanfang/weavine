import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNodeRef } from '@lezer/common';

function hide(): Decoration {
  return Decoration.replace({});
}

function styled(className: string): Decoration {
  return Decoration.mark({ class: className });
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;

  syntaxTree(view.state).iterate({
    enter(node) {
      if (!node.from) return;
      const line = view.state.doc.lineAt(node.from).number;
      const active = line === cursorLine;
      emitInlineMarkers(builder, node, view, active);
      emitBlockStyles(builder, node);
    },
  });

  return builder.finish();
}

function emitInlineMarkers(
  builder: RangeSetBuilder<Decoration>,
  node: SyntaxNodeRef,
  view: EditorView,
  active: boolean,
): void {
  const name = node.type.name;
  switch (name) {
    case 'Emphasis':
    case 'StrongEmphasis': {
      const text = view.state.doc.sliceString(node.from, node.to);
      const edges = emphasisEdges(name, text);
      if (!active) {
        if (edges.start > 0) builder.add(node.from, node.from + edges.start, hide());
        if (edges.end > 0) builder.add(node.to - edges.end, node.to, hide());
      } else {
        if (edges.start > 0) builder.add(node.from, node.from + edges.start, styled('cm-md-faint'));
        if (edges.end > 0) builder.add(node.to - edges.end, node.to, styled('cm-md-faint'));
      }
      const innerClass = name === 'StrongEmphasis' ? 'cm-md-bold' : 'cm-md-italic';
      builder.add(node.from + edges.start, node.to - edges.end, styled(innerClass));
      return;
    }
    case 'InlineCode': {
      const text = view.state.doc.sliceString(node.from, node.to);
      if (text.length < 2 || text[0] !== '`' || text[text.length - 1] !== '`') return;
      if (!active) {
        builder.add(node.from, node.from + 1, hide());
        builder.add(node.to - 1, node.to, hide());
      } else {
        builder.add(node.from, node.from + 1, styled('cm-md-faint'));
        builder.add(node.to - 1, node.to, styled('cm-md-faint'));
      }
      builder.add(node.from + 1, node.to - 1, styled('cm-md-code'));
      return;
    }
    case 'Link': {
      const text = view.state.doc.sliceString(node.from, node.to);
      const close = text.indexOf(']');
      if (close < 1 || text[0] !== '[') return;
      const paren = text.indexOf('(', close);
      if (paren !== close + 1) return;
      const parenEnd = text.lastIndexOf(')');
      if (parenEnd <= paren) return;
      if (!active) {
        builder.add(node.from, node.from + 1, hide());
        builder.add(node.from + close, node.from + close + 1, hide());
        builder.add(node.from + paren, node.from + parenEnd + 1, hide());
      } else {
        builder.add(node.from, node.from + 1, styled('cm-md-faint'));
        builder.add(node.from + close, node.from + close + 1, styled('cm-md-faint'));
        builder.add(node.from + paren, node.from + parenEnd + 1, styled('cm-md-faint'));
      }
      builder.add(node.from + 1, node.from + close, styled('cm-md-link-text'));
      return;
    }
    case 'Image': {
      const text = view.state.doc.sliceString(node.from, node.to);
      if (text.startsWith('!')) builder.add(node.from, node.to, hide());
      return;
    }
    case 'ATXHeading': {
      const text = view.state.doc.sliceString(node.from, node.to);
      const m = /^(#{1,6})\s+/.exec(text);
      if (!m) return;
      if (!active) builder.add(node.from, node.from + m[0].length, hide());
      else builder.add(node.from, node.from + m[0].length, styled('cm-md-faint'));
      return;
    }
    case 'wikilink-custom': {
      if (!active) builder.add(node.from, node.to, hide());
      else builder.add(node.from, node.to, styled('cm-md-wikilink-faint'));
      return;
    }
    default:
      return;
  }
}

function emphasisEdges(kind: string, text: string): { start: number; end: number } {
  const ch = text[0];
  if (ch !== '*' && ch !== '_') return { start: 0, end: 0 };
  const want = kind === 'StrongEmphasis' ? 2 : 1;
  let start = 0;
  while (start < text.length && text[start] === ch) start++;
  let end = 0;
  while (end < text.length && text[text.length - 1 - end] === ch) end++;
  const used = Math.min(start, end, want);
  return { start: used, end: used };
}

function emitBlockStyles(
  builder: RangeSetBuilder<Decoration>,
  node: SyntaxNodeRef,
): void {
  const name = node.type.name;
  switch (name) {
    case 'ATXHeading':
    case 'SetextHeading':
      builder.add(node.from, node.to, styled('cm-md-heading'));
      return;
    case 'Blockquote':
      builder.add(node.from, node.to, styled('cm-md-quote'));
      return;
    case 'BulletList':
    case 'OrderedList':
    case 'ListItem':
      builder.add(node.from, node.to, styled('cm-md-list'));
      return;
    case 'HorizontalRule':
      builder.add(node.from, node.to, styled('cm-md-hr'));
      return;
    case 'FencedCode':
    case 'CodeBlock':
      builder.add(node.from, node.to, styled('cm-md-fenced'));
      return;
    default:
      return;
  }
}

export const markdownPreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);