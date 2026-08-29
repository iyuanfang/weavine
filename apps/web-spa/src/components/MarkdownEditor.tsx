import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
  type CSSProperties,
} from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
  highlightActiveLineGutter,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language';
import { markdownPreview } from '../lib/cm-md-preview';

export interface MarkdownEditorHandle {
  insertAtCursor: (text: string) => void;
  wrapSelection: (before: string, after: string) => void;
  replaceLine: (text: string) => void;
  focus: () => void;
  getView: () => EditorView | null;
  runAction: (action: ToolbarAction) => void;
}

interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  minHeight?: number;
  hideToolbar?: boolean;
}

type ToolbarAction =
  | { kind: 'wrap'; before: string; after: string }
  | { kind: 'line'; insert: string }
  | { kind: 'lineApply'; insert: string }
  | { kind: 'link' }
  | { kind: 'codeBlock' }
  | { kind: 'image' }
  | { kind: 'table' }
  | { kind: 'clearFormatting' };

interface SlashChoice {
  key: string;
  label: string;
  hint: string;
  insert: string;
  category: 'heading' | 'inline' | 'block';
}

const slashChoices: SlashChoice[] = [
  { key: 'h1', label: '一级标题', hint: '⌘1', insert: '# 标题\n', category: 'heading' },
  { key: 'h2', label: '二级标题', hint: '⌘2', insert: '## 标题\n', category: 'heading' },
  { key: 'h3', label: '三级标题', hint: '⌘3', insert: '### 标题\n', category: 'heading' },
  { key: 'b', label: '加粗', hint: '⌘B', insert: '**加粗**', category: 'inline' },
  { key: 'i', label: '斜体', hint: '⌘I', insert: '*斜体*', category: 'inline' },
  { key: 's', label: '删除线', hint: '⌘⇧S', insert: '~~删除线~~', category: 'inline' },
  { key: 'mark', label: '高亮', hint: '⌘⇧H', insert: '==高亮==', category: 'inline' },
  { key: 'code', label: '行内代码', hint: '⇧⌘E', insert: '`代码`', category: 'inline' },
  { key: 'link', label: '链接', hint: '⌘K', insert: '[文字](https://)', category: 'inline' },
  { key: 'image', label: '图片', hint: '⌘⇧I', insert: '![描述](https://)', category: 'inline' },
  { key: 'codeblock', label: '代码块', hint: '⌘⇧K', insert: '```\n\n```\n', category: 'block' },
  { key: 'quote', label: '引用', hint: '⌘⇧9', insert: '> 引用\n', category: 'block' },
  { key: 'ul', label: '无序列表', hint: '⌘⇧]', insert: '- 项目\n- 项目\n', category: 'block' },
  { key: 'ol', label: '有序列表', hint: '⌘⇧[', insert: '1. 项目\n2. 项目\n', category: 'block' },
  { key: 'check', label: '待办', hint: '⌘⇧.', insert: '- [ ] 待办\n', category: 'block' },
  { key: 'table', label: '表格', hint: '⌘⇧T', insert: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |\n', category: 'block' },
  { key: 'divider', label: '分隔线', hint: '', insert: '\n---\n', category: 'block' },
];

const slashCategoryOrder: SlashChoice['category'][] = ['heading', 'inline', 'block'];
const slashCategoryLabel: Record<SlashChoice['category'], string> = {
  heading: '标题',
  inline: '行内',
  block: '区块',
};

function toggleWrap(before: string, after?: string) {
  const afterStr = after ?? before;
  return (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const sel = view.state.selection.main;
    const docLen = view.state.doc.length;

    // Both before and after markers must align — matches how Typora / Bear
    // distinguish "fully wrapped selection" (toggle off) from "plain text"
    // (toggle on). Partial overlap just re-wraps, which is harmless.
    const beforeStart = sel.from - before.length;
    const afterEnd = sel.to + afterStr.length;
    const beforeMatch =
      beforeStart >= 0 &&
      view.state.sliceDoc(beforeStart, sel.from) === before;
    const afterMatch =
      afterEnd <= docLen &&
      view.state.sliceDoc(sel.to, afterEnd) === afterStr;

    if (beforeMatch && afterMatch) {
      view.dispatch({
        changes: [
          { from: sel.to, to: afterEnd, insert: '' },
          { from: beforeStart, to: sel.from, insert: '' },
        ],
        selection: {
          anchor: beforeStart,
          head: beforeStart + (sel.to - sel.from),
        },
      });
      return true;
    }

    const selected = view.state.sliceDoc(sel.from, sel.to);
    const text = selected
      ? `${before}${selected}${afterStr}`
      : `${before}${afterStr}`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: {
        anchor: sel.from + before.length,
        head: sel.from + before.length + selected.length,
      },
    });
    return true;
  };
}

function toggleLinePrefix(prefix: string) {
  return (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const sel = view.state.selection.main;
    const startLine = view.state.doc.lineAt(sel.from);
    const endLine = view.state.doc.lineAt(sel.to);
    const changes: { from: number; to: number; insert: string }[] = [];
    let cursorShift = 0;
    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = view.state.doc.line(n);
      const headingMatch = /^(#{1,6}) /.exec(line.text);
      const hasExactPrefix = line.text.startsWith(prefix);
      const removeLen = headingMatch ? headingMatch[0].length : 0;
      const insert = hasExactPrefix ? '' : prefix;
      changes.push({ from: line.from, to: line.from + removeLen, insert });
      if (line.from <= sel.head && sel.head <= line.to) {
        cursorShift = insert.length - removeLen;
      }
    }
    view.dispatch({
      changes,
      selection: { anchor: sel.anchor + cursorShift, head: sel.head + cursorShift },
    });
    return true;
  };
}

function demoteHeading() {
  return (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const sel = view.state.selection.main;
    const startLine = view.state.doc.lineAt(sel.from);
    const endLine = view.state.doc.lineAt(sel.to);
    const changes: { from: number; to: number; insert: string }[] = [];
    let cursorShift = 0;
    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = view.state.doc.line(n);
      const m = /^(#{1,6}) /.exec(line.text);
      const removeLen = m ? m[0].length : 0;
      changes.push({ from: line.from, to: line.from + removeLen, insert: '' });
      if (line.from <= sel.head && sel.head <= line.to) {
        cursorShift = -removeLen;
      }
    }
    view.dispatch({
      changes,
      selection: { anchor: sel.anchor + cursorShift, head: sel.head + cursorShift },
    });
    return true;
  };
}

// Fenced status is detected by looking at the lines immediately above and below the
// selection — not the selection itself — because Typora / Obsidian toggle behaviour
// expects the user to select the inner text and re-press the shortcut to unwrap.
function toggleCodeBlock() {
  return (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const sel = view.state.selection.main;
    const startLine = view.state.doc.lineAt(sel.from);
    const endLine = view.state.doc.lineAt(sel.to);
    const above = startLine.number > 1 ? view.state.doc.line(startLine.number - 1) : null;
    const below = endLine.number < view.state.doc.lines ? view.state.doc.line(endLine.number + 1) : null;
    const fencedByLines =
      !!above && !!below && above.text.startsWith('```') && below.text.startsWith('```');

    if (fencedByLines && above && below) {
      view.dispatch({
        changes: { from: above.from, to: below.from, insert: '' },
      });
      return true;
    }

    if (sel.empty) {
      const insert = '```\n\n```\n';
      view.dispatch({
        changes: { from: sel.from, insert },
        selection: { anchor: sel.from + 4, head: sel.from + 4 },
      });
      return true;
    }

    const selected = view.state.sliceDoc(sel.from, sel.to);
    const beforePad = startLine.from === sel.from ? '' : '\n';
    const afterPad = endLine.to === sel.to ? '' : '\n';
    const insert = `\`\`\`${beforePad}${selected}${afterPad}\`\`\`\n`;
    const selStart = sel.from + 3 + (beforePad ? 1 : 0);
    const selEnd = selStart + selected.length;
    view.dispatch({
      changes: { from: sel.from - (beforePad ? 1 : 0) - 3, to: sel.to + (afterPad ? 1 : 0) + 3, insert },
      selection: { anchor: selStart, head: selEnd },
    });
    return true;
  };
}

function clearFormatting(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const sel = view.state.selection.main;
  if (sel.empty) return false;
  const patterns: { open: string; close: string }[] = [
    { open: '**', close: '**' },
    { open: '~~', close: '~~' },
    { open: '`', close: '`' },
    { open: '==', close: '==' },
    { open: '*', close: '*' },
  ];
  for (const { open, close } of patterns) {
    const beforeStart = sel.from - open.length;
    const afterEnd = sel.to + close.length;
    const beforeMatch =
      beforeStart >= 0 && view.state.sliceDoc(beforeStart, sel.from) === open;
    const afterMatch =
      afterEnd <= view.state.doc.length && view.state.sliceDoc(sel.to, afterEnd) === close;
    if (beforeMatch && afterMatch) {
      view.dispatch({
        changes: [
          { from: sel.to, to: afterEnd, insert: '' },
          { from: beforeStart, to: sel.from, insert: '' },
        ],
        selection: {
          anchor: beforeStart,
          head: beforeStart + (sel.to - sel.from),
        },
      });
      return true;
    }
  }
  return false;
}

function moveSelectedLines(dir: -1 | 1) {
  return (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const sel = view.state.selection.main;
    const startLine = view.state.doc.lineAt(sel.from);
    const endLine = view.state.doc.lineAt(sel.to);
    const targetLineNo = dir === -1 ? startLine.number - 1 : endLine.number + 1;
    if (targetLineNo < 1 || targetLineNo > view.state.doc.lines) return false;

    const isFirstLine = startLine.number === 1;
    const isLastLine = endLine.number === view.state.doc.lines;

    let from: number;
    let to: number;
    if (dir === -1) {
      const targetLine = view.state.doc.line(targetLineNo);
      from = targetLine.from;
      to = isLastLine ? endLine.to : endLine.to + 1;
    } else {
      const targetLine = view.state.doc.line(targetLineNo);
      from = isFirstLine ? startLine.from : startLine.from - 1;
      to = targetLine.to;
    }

    const headOffset = sel.head - startLine.from;
    const anchorOffset = sel.anchor - startLine.from;

    const blockText = view.state.sliceDoc(startLine.from, isLastLine ? endLine.to : endLine.to + 1);
    const targetEnd = dir === -1
      ? startLine.from
      : endLine.number < view.state.doc.lines ? endLine.to + 1 : endLine.to;
    const targetText = view.state.sliceDoc(from, targetEnd);
    const insert = dir === -1 ? `${blockText}${targetText}` : `${targetText}${blockText}`;
    const anchor = from + (dir === -1 ? blockText.length : 0) + anchorOffset;
    const head = from + (dir === -1 ? blockText.length : 0) + headOffset;

    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor, head },
    });
    return true;
  };
}

function buildTable(cols: number, rows: number): string {
  const headerCells = Array.from({ length: cols }, (_, i) => ` 列${i + 1} `).join('|');
  const sep = Array.from({ length: cols }, () => ' --- ').join('|');
  const bodyRows = Array.from({ length: rows - 1 }, () =>
    Array.from({ length: cols }, () => '     ').join('|'),
  );
  return `|${headerCells}|\n|${sep}|\n${bodyRows.map((r) => `|${r}|`).join('\n')}\n`;
}

function insertTable(rows = 3, cols = 3) {
  return (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    const atLineStart = line.from;
    const text = buildTable(cols, rows);
    const needsLeadingNewline = atLineStart > 0 && view.state.sliceDoc(atLineStart - 1, atLineStart) !== '\n';
    const insert = `${needsLeadingNewline ? '\n' : ''}${text}`;
    view.dispatch({
      changes: { from: atLineStart, insert },
      selection: { anchor: atLineStart + insert.length - 1 },
    });
    view.focus();
    return true;
  };
}

function insertImage() {
  return (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const sel = view.state.selection.main;
    const altText = sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to);
    const snippet = `![${altText}](https://)`;
    if (sel.empty) {
      view.dispatch({
        changes: { from: sel.head, insert: snippet },
        selection: { anchor: sel.head + 2, head: sel.head + 2 },
      });
    } else {
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: snippet } });
    }
    view.focus();
    return true;
  };
}

function buildState(doc: string, readOnly: boolean): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      bracketMatching(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      highlightActiveLine(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
        { key: 'Mod-b', run: toggleWrap('**') },
        { key: 'Mod-B', run: toggleWrap('**') },
        { key: 'Mod-i', run: toggleWrap('*') },
        { key: 'Mod-I', run: toggleWrap('*') },
{ key: 'Mod-k', run: toggleWrap('[', '](https://)') },
  { key: 'Mod-Shift-e', run: toggleWrap('`') },
  { key: 'Mod-Shift-E', run: toggleWrap('`') },
  { key: 'Mod-Shift-s', run: toggleWrap('~~') },
  { key: 'Mod-Shift-S', run: toggleWrap('~~') },
  { key: 'Mod-Shift-h', run: toggleWrap('==') },
  { key: 'Mod-Shift-H', run: toggleWrap('==') },
        { key: 'Mod-Shift-k', run: toggleCodeBlock() },
        { key: 'Mod-Shift-K', run: toggleCodeBlock() },
        { key: 'Mod-Shift-t', run: insertTable() },
        { key: 'Mod-Shift-T', run: insertTable() },
        { key: 'Mod-Shift-i', run: insertImage() },
        { key: 'Mod-Shift-I', run: insertImage() },
        { key: 'Mod-\\', run: clearFormatting },
        { key: 'Mod-Shift-ArrowUp', run: moveSelectedLines(-1) },
        { key: 'Mod-Shift-ArrowDown', run: moveSelectedLines(1) },
        { key: 'Mod-1', run: toggleLinePrefix('# ') },
        { key: 'Mod-2', run: toggleLinePrefix('## ') },
        { key: 'Mod-3', run: toggleLinePrefix('### ') },
        { key: 'Mod-4', run: toggleLinePrefix('#### ') },
        { key: 'Mod-5', run: toggleLinePrefix('##### ') },
        { key: 'Mod-6', run: toggleLinePrefix('###### ') },
        { key: 'Mod-0', run: demoteHeading() },
        { key: 'Mod-Shift-]', run: toggleLinePrefix('- ') },
        { key: 'Mod-Shift-[', run: toggleLinePrefix('1. ') },
        { key: 'Mod-Shift-9', run: toggleLinePrefix('> ') },
        { key: 'Mod-Shift-.', run: toggleLinePrefix('- [ ] ') },
      ]),
      markdown({ base: markdownLanguage, codeLanguages: () => null }),
      markdownPreview,
      EditorView.lineWrapping,
      EditorState.readOnly.of(readOnly),
      EditorView.contentAttributes.of({ spellcheck: 'true' }),
      EditorView.updateListener.of((v) => {
        if (v.docChanged) {
          v.view.dom.dispatchEvent(
            new CustomEvent('markdown-change', { detail: v.state.doc.toString() }),
          );
        }
      }),
    ],
  });
}

function runToolbarAction(view: EditorView, action: ToolbarAction): void {
  const sel = view.state.selection.main;
  switch (action.kind) {
    case 'wrap': {
      toggleWrap(action.before, action.after)(view);
      view.focus();
      return;
    }
    case 'link': {
      toggleWrap('[', '](https://)')(view);
      view.focus();
      return;
    }
    case 'codeBlock': {
      toggleCodeBlock()(view);
      view.focus();
      return;
    }
    case 'clearFormatting': {
      clearFormatting(view);
      view.focus();
      return;
    }
    case 'table': {
      insertTable()(view);
      return;
    }
    case 'image': {
      insertImage()(view);
      return;
    }
    case 'lineApply': {
      const line = view.state.doc.lineAt(sel.head);
      const hasPrefix = line.text.startsWith(action.insert);
      view.dispatch({
        changes: {
          from: line.from,
          to: line.from + (hasPrefix ? action.insert.length : 0),
          insert: hasPrefix ? '' : action.insert,
        },
      });
      view.focus();
      return;
    }
    case 'line': {
      const line = view.state.doc.lineAt(sel.head);
      view.dispatch({
        changes: { from: line.from, to: line.from, insert: action.insert },
        selection: { anchor: sel.head + action.insert.length },
      });
      view.focus();
      return;
    }
  }
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ value, onChange, readOnly, minHeight = 360, hideToolbar = false }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const readOnlyComp = useRef(new Compartment());
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number } | null>(null);
    const [slashMenu, setSlashMenu] = useState<{
      x: number;
      y: number;
      query: string;
      lineStart: number;
    } | null>(null);

    useEffect(() => {
      if (!hostRef.current) return;
      const view = new EditorView({
        state: buildState(value, !!readOnly),
        parent: hostRef.current,
      });
      viewRef.current = view;

      const handler = (e: Event) => onChangeRef.current((e as CustomEvent<string>).detail);
      view.dom.addEventListener('markdown-change', handler);

      const refresh = () => {
        const ranges = view.state.selection.ranges;
        const hasSel = ranges.length === 1 && !ranges[0].empty;
        if (hasSel) {
          const from = view.coordsAtPos(ranges[0].from);
          const to = view.coordsAtPos(ranges[0].to);
          if (from && to) {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            let x = (from.left + to.right) / 2;
            let y = from.top - 8;
            if (x < 80) x = 80;
            if (x > vw - 80) x = vw - 80;
            if (y < 80) y = to.bottom + 28;
            if (y > vh - 60) y = Math.max(60, to.bottom - 28);
            setSelectionMenu({ x, y });
          }
        } else {
          setSelectionMenu(null);
        }
        const sel = view.state.selection.main;
        const line = view.state.doc.lineAt(sel.head);
        const before = view.state.doc.sliceString(line.from, sel.head);
        const m = /(^|\s)\/(\w*)$/.exec(before);
        if (!m) {
          setSlashMenu(null);
        } else {
          const coords = view.coordsAtPos(sel.head);
          if (coords) {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            let x = coords.left;
            let y = coords.bottom + 4;
            if (x < 4) x = 4;
            if (x > vw - 220) x = vw - 224;
            if (y > vh - 220) y = coords.top - 220;
            const lineStart = line.from + m.index + m[1].length;
            setSlashMenu({ x, y, query: m[2], lineStart });
          }
        }
      };
      view.dom.addEventListener('mouseup', refresh);
      view.dom.addEventListener('keyup', refresh);

      return () => {
        view.dom.removeEventListener('markdown-change', handler);
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      if (view.state.doc.toString() === value) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }, [value]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: readOnlyComp.current.reconfigure(EditorState.readOnly.of(!!readOnly)),
      });
    }, [readOnly]);

    useImperativeHandle(
      ref,
      () => ({
        insertAtCursor: (text) => {
          const view = viewRef.current;
          if (!view) return;
          const sel = view.state.selection.main;
          view.dispatch({
            changes: { from: sel.head, insert: text },
            selection: { anchor: sel.head + text.length },
          });
          view.focus();
        },
        wrapSelection: (before, after) => {
          runToolbarAction(viewRef.current!, { kind: 'wrap', before, after });
        },
        replaceLine: (text) => {
          const view = viewRef.current;
          if (!view) return;
          const sel = view.state.selection.main;
          const line = view.state.doc.lineAt(sel.head);
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: text },
            selection: { anchor: line.from + text.length },
          });
          view.focus();
        },
        focus: () => viewRef.current?.focus(),
        getView: () => viewRef.current,
        runAction: (action) => {
          const view = viewRef.current;
          if (!view) return;
          runToolbarAction(view, action);
        },
      }),
      [],
    );

    function applySlashChoice(choice: SlashChoice): void {
      const view = viewRef.current;
      const menu = slashMenu;
      if (!view || !menu) return;
      const replacementLength = 1 + menu.query.length;
      view.dispatch({
        changes: { from: menu.lineStart, to: menu.lineStart + replacementLength, insert: choice.insert },
        selection: { anchor: menu.lineStart + choice.insert.length },
      });
      setSlashMenu(null);
      view.focus();
    }

    return (
      <div style={{ position: 'relative' }}>
        {!readOnly && !hideToolbar && (
          <EditorToolbar
            onAction={(action) => {
              const view = viewRef.current;
              if (!view) return;
              runToolbarAction(view, action);
            }}
          />
        )}
        <div
          ref={hostRef}
          className="md-editor-host"
          data-testid="markdown-editor"
          style={{ minHeight } as CSSProperties}
        />
        {selectionMenu && !slashMenu && !readOnly && (
          <BubbleToolbar
            x={selectionMenu.x}
            y={selectionMenu.y}
            onAction={(action) => {
              const view = viewRef.current;
              if (!view) return;
              runToolbarAction(view, action);
              setSelectionMenu(null);
            }}
          />
        )}
        {slashMenu && !readOnly && (
          <SlashMenu
            x={slashMenu.x}
            y={slashMenu.y}
            query={slashMenu.query}
            onPick={applySlashChoice}
            onDismiss={() => setSlashMenu(null)}
          />
        )}
      </div>
    );
  },
);

export function EditorToolbar({ onAction }: { onAction: (action: ToolbarAction) => void }) {
  return (
    <div className="md-editor-toolbar" data-testid="md-editor-toolbar">
      <ToolbarBtn label="H1" title="一级标题 ⌘1" onClick={() => onAction({ kind: 'lineApply', insert: '# ' })} />
      <ToolbarBtn label="H2" title="二级标题 ⌘2" onClick={() => onAction({ kind: 'lineApply', insert: '## ' })} />
      <ToolbarBtn label="H3" title="三级标题 ⌘3" onClick={() => onAction({ kind: 'lineApply', insert: '### ' })} />
      <ToolbarSep />
      <ToolbarBtn label="B" title="加粗 ⌘B" onClick={() => onAction({ kind: 'wrap', before: '**', after: '**' })} />
      <ToolbarBtn label="I" title="斜体 ⌘I" onClick={() => onAction({ kind: 'wrap', before: '*', after: '*' })} />
      <ToolbarBtn label="S" title="删除线 ⌘⇧S" onClick={() => onAction({ kind: 'wrap', before: '~~', after: '~~' })} />
      <ToolbarBtn label="M" title="高亮 ⌘⇧H" onClick={() => onAction({ kind: 'wrap', before: '==', after: '==' })} />
      <ToolbarBtn label="</>" title="行内代码 ⇧⌘E" onClick={() => onAction({ kind: 'wrap', before: '`', after: '`' })} />
      <ToolbarBtn label="{}" title="代码块 ⌘⇧K" onClick={() => onAction({ kind: 'codeBlock' })} />
      <ToolbarSep />
      <ToolbarBtn label="🔗" title="链接 ⌘K" onClick={() => onAction({ kind: 'link' })} />
      <ToolbarBtn label="🖼" title="图片 ⌘⇧I" onClick={() => onAction({ kind: 'image' })} />
      <ToolbarBtn label="❝" title="引用 ⌘⇧9" onClick={() => onAction({ kind: 'lineApply', insert: '> ' })} />
      <ToolbarBtn label="•" title="无序列表 ⌘⇧]" onClick={() => onAction({ kind: 'lineApply', insert: '- ' })} />
      <ToolbarBtn label="1." title="有序列表 ⌘⇧[" onClick={() => onAction({ kind: 'lineApply', insert: '1. ' })} />
      <ToolbarBtn label="☑" title="待办 ⌘⇧." onClick={() => onAction({ kind: 'lineApply', insert: '- [ ] ' })} />
      <ToolbarBtn label="⊞" title="表格 ⌘⇧T" onClick={() => onAction({ kind: 'table' })} />
      <ToolbarSep />
      <ToolbarBtn label="—" title="分隔线" onClick={() => onAction({ kind: 'line', insert: '\n---\n' })} />
      <ToolbarBtn label="×" title="清除格式 ⌘\" onClick={() => onAction({ kind: 'clearFormatting' })} />
    </div>
  );
}

function ToolbarBtn({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="md-editor-toolbar__btn"
      title={title}
      data-testid={`md-tb-${label}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ToolbarSep() {
  return <span className="md-editor-toolbar__sep" />;
}

function BubbleToolbar({ x, y, onAction }: { x: number; y: number; onAction: (a: ToolbarAction) => void }) {
  return (
    <div
      className="md-bubble-toolbar"
      style={{ left: x, top: y, transform: 'translate(-50%, -100%)' }}
      data-testid="md-bubble-toolbar"
    >
      <ToolbarBtn label="B" title="加粗 ⌘B" onClick={() => onAction({ kind: 'wrap', before: '**', after: '**' })} />
      <ToolbarBtn label="I" title="斜体 ⌘I" onClick={() => onAction({ kind: 'wrap', before: '*', after: '*' })} />
      <ToolbarBtn label="S" title="删除线 ⌘⇧S" onClick={() => onAction({ kind: 'wrap', before: '~~', after: '~~' })} />
      <ToolbarBtn label="</>" title="行内代码 ⇧⌘E" onClick={() => onAction({ kind: 'wrap', before: '`', after: '`' })} />
      <ToolbarSep />
      <ToolbarBtn label="🔗" title="链接 ⌘K" onClick={() => onAction({ kind: 'link' })} />
      <ToolbarBtn label="H2" title="二级标题 ⌘2" onClick={() => onAction({ kind: 'lineApply', insert: '## ' })} />
    </div>
  );
}

function SlashMenu({
  x,
  y,
  query,
  onPick,
  onDismiss,
}: {
  x: number;
  y: number;
  query: string;
  onPick: (c: SlashChoice) => void;
  onDismiss: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const filtered = slashChoices.filter((c) => c.key.includes(query.toLowerCase()) || query === '');
  const list = filtered.length > 0 ? filtered : slashChoices;

  useEffect(() => {
    setIdx(0);
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => (i + 1) % list.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => (i - 1 + list.length) % list.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onPick(list[idx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [list, idx, onPick, onDismiss]);

  return (
    <div
      className="md-slash-menu"
      style={{ left: x, top: y }}
      data-testid="md-slash-menu"
      onMouseDown={(e) => e.preventDefault()}
    >
      {slashCategoryOrder.map((cat) => {
        const items = list.filter((c) => c.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="md-slash-menu__group" data-testid={`md-slash-group-${cat}`}>
            <div className="md-slash-menu__group-label">{slashCategoryLabel[cat]}</div>
            {items.map((c) => {
              const flatIdx = list.indexOf(c);
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`md-slash-menu__item ${flatIdx === idx ? 'is-active' : ''}`}
                  onClick={() => onPick(c)}
                  data-testid={`md-slash-${c.key}`}
                >
                  <span className="md-slash-menu__label">{c.label}</span>
                  {c.hint && <span className="md-slash-menu__hint">{c.hint}</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}