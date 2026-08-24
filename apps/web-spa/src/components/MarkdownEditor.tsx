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
  wrapSelection: (before: string, after: string, placeholder?: string) => void;
  replaceLine: (text: string) => void;
  focus: () => void;
  getView: () => EditorView | null;
}

interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  minHeight?: number;
}

type ToolbarAction =
  | { kind: 'wrap'; before: string; after: string; placeholder?: string }
  | { kind: 'line'; insert: string }
  | { kind: 'lineApply'; insert: string }
  | { kind: 'link' };

interface SlashChoice {
  key: string;
  label: string;
  hint: string;
  insert: string;
}

const slashChoices: SlashChoice[] = [
  { key: 'h1', label: '一级标题', hint: 'H1', insert: '# 标题\n' },
  { key: 'h2', label: '二级标题', hint: 'H2', insert: '## 标题\n' },
  { key: 'h3', label: '三级标题', hint: 'H3', insert: '### 标题\n' },
  { key: 'b', label: '加粗', hint: '⌘B', insert: '**加粗**' },
  { key: 'i', label: '斜体', hint: '⌘I', insert: '*斜体*' },
  { key: 'link', label: '链接', hint: '', insert: '[文字](https://)' },
  { key: 'code', label: '行内代码', hint: '', insert: '`代码`' },
  { key: 'quote', label: '引用', hint: '', insert: '> 引用\n' },
  { key: 'ul', label: '无序列表', hint: '', insert: '- 项目\n- 项目\n' },
  { key: 'ol', label: '有序列表', hint: '', insert: '1. 项目\n2. 项目\n' },
  { key: 'check', label: '待办', hint: '', insert: '- [ ] 待办\n' },
  { key: 'divider', label: '分隔线', hint: '', insert: '\n---\n' },
];

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
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
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
      const selected = view.state.sliceDoc(sel.from, sel.to);
      if (selected.length === 0) {
        const text = `${action.before}${action.placeholder ?? ''}${action.after}`;
        view.dispatch({
          changes: { from: sel.from, insert: text },
          selection: {
            anchor: sel.from + action.before.length,
            head: sel.from + action.before.length + (action.placeholder?.length ?? 0),
          },
        });
      } else {
        const text = `${action.before}${selected}${action.after}`;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: {
            anchor: sel.from + action.before.length,
            head: sel.from + action.before.length + selected.length,
          },
        });
      }
      view.focus();
      return;
    }
    case 'lineApply': {
      const line = view.state.doc.lineAt(sel.head);
      if (!line.text.startsWith(action.insert)) {
        view.dispatch({
          changes: { from: line.from, to: line.from, insert: action.insert },
        });
      }
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
    case 'link': {
      const selected = view.state.sliceDoc(sel.from, sel.to);
      const text = selected ? `[${selected}](https://)` : '[文字](https://)';
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: {
          anchor: sel.from + (selected ? selected.length + 3 : 3),
          head: sel.from + (selected ? selected.length + 3 : 3),
        },
      });
      view.focus();
      return;
    }
  }
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ value, onChange, readOnly, minHeight = 360 }, ref) {
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
        wrapSelection: (before, after, placeholder) => {
          runToolbarAction(viewRef.current!, { kind: 'wrap', before, after, placeholder });
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
        {!readOnly && (
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

function EditorToolbar({ onAction }: { onAction: (action: ToolbarAction) => void }) {
  return (
    <div className="md-editor-toolbar" data-testid="md-editor-toolbar">
      <ToolbarBtn label="H1" title="一级标题" onClick={() => onAction({ kind: 'line', insert: '# ' })} />
      <ToolbarBtn label="H2" title="二级标题" onClick={() => onAction({ kind: 'line', insert: '## ' })} />
      <ToolbarBtn label="H3" title="三级标题" onClick={() => onAction({ kind: 'line', insert: '### ' })} />
      <ToolbarSep />
      <ToolbarBtn label="B" title="加粗 ⌘B" onClick={() => onAction({ kind: 'wrap', before: '**', after: '**', placeholder: '加粗' })} />
      <ToolbarBtn label="I" title="斜体 ⌘I" onClick={() => onAction({ kind: 'wrap', before: '*', after: '*', placeholder: '斜体' })} />
      <ToolbarBtn label="</>" title="行内代码" onClick={() => onAction({ kind: 'wrap', before: '`', after: '`', placeholder: '代码' })} />
      <ToolbarSep />
      <ToolbarBtn label="🔗" title="链接" onClick={() => onAction({ kind: 'link' })} />
      <ToolbarBtn label="❝" title="引用" onClick={() => onAction({ kind: 'line', insert: '> ' })} />
      <ToolbarBtn label="•" title="无序列表" onClick={() => onAction({ kind: 'line', insert: '- ' })} />
      <ToolbarBtn label="1." title="有序列表" onClick={() => onAction({ kind: 'line', insert: '1. ' })} />
      <ToolbarBtn label="☑" title="待办" onClick={() => onAction({ kind: 'line', insert: '- [ ] ' })} />
      <ToolbarBtn label="—" title="分隔线" onClick={() => onAction({ kind: 'line', insert: '\n---\n' })} />
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
      <ToolbarBtn label="B" title="加粗" onClick={() => onAction({ kind: 'wrap', before: '**', after: '**' })} />
      <ToolbarBtn label="I" title="斜体" onClick={() => onAction({ kind: 'wrap', before: '*', after: '*' })} />
      <ToolbarBtn label="H2" title="二级标题" onClick={() => onAction({ kind: 'lineApply', insert: '## ' })} />
      <ToolbarBtn label="🔗" title="链接" onClick={() => onAction({ kind: 'link' })} />
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
      {list.map((c, i) => (
        <button
          key={c.key}
          type="button"
          className={`md-slash-menu__item ${i === idx ? 'is-active' : ''}`}
          onClick={() => onPick(c)}
          data-testid={`md-slash-${c.key}`}
        >
          <span className="md-slash-menu__label">{c.label}</span>
          {c.hint && <span className="md-slash-menu__hint">{c.hint}</span>}
        </button>
      ))}
    </div>
  );
}