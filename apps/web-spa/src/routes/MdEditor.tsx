/**
 * §11.7 md file editor route.
 *
 * Loads a .md file from disk via `adapter.md.readFile()`, edits in textarea,
 * saves back via `adapter.md.writeFile()`. Optional "导入库" button that
 * pushes current content into the note library (with re-import mtime check).
 *
 * Mounted at `/md-editor` and `/md-editor?path=...`. AppShell listens for
 * `open-md-from-argv` events from Tauri and pushes this route.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { renderMarkdown } from '../lib/markdown';
import { parseTocHeadings } from '../lib/markdown-toc';
import { usePageScrollLock } from '../lib/use-page-scroll-lock';

export function MdEditor() {
  const adapter = useAdapter();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  usePageScrollLock();
  const path = params.get('path');
  const [content, setContent] = useState('');
  const [, setOriginalMtime] = useState<number | null>(null);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [encoding, setEncoding] = useState('');
  const [view, setView] = useState<'edit' | 'preview' | 'split'>('split');
  const [tocOpen, setTocOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const closeGuard = useCallback(
    (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    },
    [dirty],
  );
  useEffect(() => {
    window.addEventListener('beforeunload', closeGuard);
    return () => window.removeEventListener('beforeunload', closeGuard);
  }, [closeGuard]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const lu = await adapter.getLocalUser();
        if (!mounted) return;
        if (lu?.id) setUserId(lu.id);
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, [adapter]);

  useEffect(() => {
    if (!path) return;
    let mounted = true;
    (async () => {
      try {
        setError(null);
        const r = await adapter.md.readFile(path);
        if (!mounted) return;
        setContent(r.content);
        setOriginalMtime(r.mtime_unix_ms);
        setSizeBytes(r.size_bytes);
        setEncoding(r.encoding);
        setDirty(false);
        if (r.had_replacement_chars) {
          setError(`解码警告：检测到无法表示字符（U+FFFD），原文件可能是 GBK 编码`);
        }
        await adapter.md.addRecentFile(path);
      } catch (e) {
        if (mounted) setError(`打开失败: ${String(e)}`);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [path, adapter]);

  const openFile = useCallback(async () => {
    try {
      const selected = await adapter.md.openDialog();
      if (selected) setParams({ path: selected });
    } catch (e) {
      setError(String(e));
    }
  }, [adapter, setParams]);

  const saveFile = useCallback(
    async (silent = false) => {
      if (!path) return;
      try {
        const r = await adapter.md.writeFile(path, content);
        setOriginalMtime(r.mtime_unix_ms);
        setSizeBytes(r.size_bytes);
        setDirty(false);
        if (!silent) setInfo(`已保存 (${(r.size_bytes / 1024).toFixed(1)} KB)`);
      } catch (e) {
        setError(`保存失败: ${String(e)}`);
      }
    },
    [adapter, path, content],
  );

  const saveAs = useCallback(async () => {
    try {
      const newPath = await adapter.md.saveDialog(path ? path.split(/[\\/]/).pop() ?? null : null);
      if (!newPath) return;
      const r = await adapter.md.writeFile(newPath, content);
      setParams({ path: newPath });
      setOriginalMtime(r.mtime_unix_ms);
      setSizeBytes(r.size_bytes);
      setDirty(false);
      setInfo(`已另存为: ${newPath}`);
      await adapter.md.addRecentFile(newPath);
    } catch (e) {
      setError(String(e));
    }
  }, [adapter, content, path, setParams]);

  const importToLibrary = useCallback(async () => {
    if (!path || !userId) return;
    const finish = (noteId: string, action: string) => {
      setInfo(`✓ 已转存为笔记（${action}）`);
      navigate(`/notes/${noteId}`);
    };
    try {
      const status = await adapter.md.checkImportStatus(userId, path);
      if (!status.already_imported) {
        const r = await adapter.md.importToLibrary({
          user_id: userId,
          path,
          title: null,
          body: content,
          mode: 'create',
          existing_note_id: null,
        });
        finish(r.note_id, r.action);
        return;
      }
      if (!status.reimport_needed) {
        setInfo(`该文件已是最新，无需重导（已在 ${status.imported_at} 导入）`);
        return;
      }
      // reimport_needed: caller must pick mode via UI prompt
      const choice = window.prompt(
        `该 .md 已在 ${status.imported_at} 导入库，笔记标题「${status.note_title ?? ''}」。\n` +
          `文件已被外部修改。输入选项：\n` +
          `  update   — 覆盖已有笔记 body\n` +
          `  as-new   — 作为新笔记导入\n` +
          `  skip     — 跳过\n` +
          `（取消 = 关闭对话框）`,
        'update',
      );
      if (!choice) return;
      const mode = choice.trim();
      if (!['update', 'as-new', 'skip'].includes(mode)) {
        setError(`未知选项: ${mode}`);
        return;
      }
      const r = await adapter.md.importToLibrary({
        user_id: userId,
        path,
        title: null,
        body: content,
        mode: mode as 'update' | 'as-new' | 'skip',
        existing_note_id: status.note_id,
      });
      finish(r.note_id, r.action);
    } catch (e) {
      setError(`导入失败: ${String(e)}`);
    }
  }, [adapter, content, navigate, path, userId]);

  // Parse headings for the TOC sidebar via the shared helper.
  const tocHeadings = useMemo(() => parseTocHeadings(content), [content]);

  // Scroll the textarea so that line N is near the top. The editor is a
  // plain <textarea>, so per-line scroll is approximated by
  // scrollTop ≈ line * lineHeight. The 22px figure matches the
  // monospace line-height in the JSX (14 * 1.6 ≈ 22.4).
  const LINE_HEIGHT = 22;
  const scrollToLine = useCallback(
    (line: number) => {
      const ta = taRef.current;
      if (!ta) return;
      const target = Math.max(0, line * LINE_HEIGHT - 16);
      ta.scrollTop = target;
      ta.focus();
    },
    [],
  );

  const largeFile = sizeBytes > 1_048_576;
  const banner = largeFile
    ? `文件较大 (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB)，可能影响性能；导入库按钮已禁用`
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border, #e5e7eb)',
          flexWrap: 'wrap',
        }}
      >
        <button type="button" className="btn btn-secondary" onClick={openFile}>
          📂 打开 .md
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => saveFile(false)}
          disabled={!path || !dirty}
        >
          💾 保存
        </button>
        <button type="button" className="btn btn-secondary" onClick={saveAs} disabled={!path}>
          💾 另存为
        </button>
        <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: 13 }}>
          {path ? `${path} · ${(sizeBytes / 1024).toFixed(1)} KB · ${encoding}` : '未打开文件'}
          {dirty ? ' · ●未保存' : ''}
        </span>
        <div role="tablist" style={{ display: 'inline-flex', border: '1px solid var(--border, #e5e7eb)', borderRadius: 4, overflow: 'hidden' }}>
          {(['edit', 'preview', 'split'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              style={{
                padding: '4px 12px',
                border: 'none',
                background: view === v ? 'var(--accent, #059669)' : 'transparent',
                color: view === v ? '#fff' : 'var(--text, #111)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {v === 'edit' ? '编辑' : v === 'preview' ? '预览' : '分屏'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={importToLibrary}
          disabled={!path || !userId || largeFile}
          title={!userId ? '需要本地用户' : largeFile ? '文件 > 1 MB 不可入库' : '将当前内容复制到笔记库'}
        >
          📥 转存为笔记
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate(-1)}
        >
          返回
        </button>
      </div>

      {banner && (
        <div
          style={{
            background: 'var(--warn-soft, #fef3c7)',
            color: 'var(--warn, #92400e)',
            padding: '8px 12px',
            fontSize: 13,
          }}
        >
          ⚠️ {banner}
        </div>
      )}
      {error && (
        <div
          style={{
            background: 'var(--error-soft, #fee2e2)',
            color: 'var(--error, #991b1b)',
            padding: '8px 12px',
            fontSize: 13,
          }}
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ marginLeft: 8, background: 'transparent', border: 'none' }}
          >
            ×
          </button>
        </div>
      )}
      {info && (
        <div
          style={{
            background: 'var(--accent-soft, #d1fae5)',
            color: 'var(--accent, #065f46)',
            padding: '8px 12px',
            fontSize: 13,
          }}
        >
          {info}
          <button
            type="button"
            onClick={() => setInfo(null)}
            style={{ marginLeft: 8, background: 'transparent', border: 'none' }}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        {tocOpen && (
          <TocPanel headings={tocHeadings} onSelect={scrollToLine} onToggle={() => setTocOpen(false)} />
        )}
        {!tocOpen && (
          <button
            type="button"
            onClick={() => setTocOpen(true)}
            title="展开目录"
            aria-label="展开目录"
            style={{
              alignSelf: 'flex-start',
              marginTop: 4,
              padding: '4px 6px',
              border: '1px solid var(--border, #e5e7eb)',
              background: 'var(--surface-alt, #f9fafb)',
              cursor: 'pointer',
              fontSize: 12,
              borderRadius: 4,
              color: 'var(--text-muted)',
              writingMode: 'vertical-rl',
              letterSpacing: 0.4,
            }}
          >
            ▶ 目录
          </button>
        )}
        {(view === 'edit' || view === 'split') && (
          <div
            className={view === 'split' ? 'md-edit-pane md-edit-pane--split' : 'md-edit-pane md-edit-pane--solo'}
            style={{ flex: 1, minWidth: 0, display: 'flex' }}
          >
            <textarea
              ref={taRef}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                  e.preventDefault();
                  saveFile(false);
                }
              }}
              spellCheck={false}
              style={{
                flex: 1,
                padding: '12px',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 14,
                lineHeight: 1.6,
                background: 'var(--surface, #fff)',
                color: 'var(--text, #111)',
                minWidth: 0,
                minHeight: 0,
              }}
              placeholder={path ? '' : '点「📂 打开 .md」选择本地 Markdown 文件…'}
            />
          </div>
        )}
        {(view === 'preview' || view === 'split') && (
          <div
            style={{
              flex: 1,
              padding: '12px 20px',
              borderLeft: view === 'split' ? '1px solid var(--border, #e5e7eb)' : 'none',
              background: 'var(--surface-alt, #f9fafb)',
              minWidth: 0,
            }}
          >
            <div
            className="markdown-body"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(content) || (path ? '' : '<p><em>选择文件后预览将显示在此</em></p>'),
            }}
          />
          </div>
        )}
      </div>

      <div
        style={{
          padding: '4px 12px',
          borderTop: '1px solid var(--border, #e5e7eb)',
          fontSize: 12,
          color: 'var(--text-muted)',
          display: 'flex',
          gap: 16,
        }}
      >
        <span>行: {content.split('\n').length}</span>
        <span>字符: {content.length}</span>
        <span style={{ flex: 1 }} />
        <span>编辑器态 · 不会同步到云端</span>
      </div>
    </div>
  );
}

interface TocPanelProps {
  headings: { level: 1 | 2 | 3; text: string; line: number }[];
  onSelect: (line: number) => void;
  onToggle: () => void;
}

function TocPanel({ headings, onSelect, onToggle }: TocPanelProps) {
  return (
    <nav
      className="md-toc"
      aria-label="文档目录"
      style={{
        width: 220,
        minWidth: 220,
        maxWidth: 220,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border, #e5e7eb)',
        background: 'var(--surface-alt, #f9fafb)',
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 8px 6px 12px',
          flexShrink: 0,
          borderBottom: '1px solid var(--border, #e5e7eb)',
          background: 'var(--surface-alt, #f9fafb)',
        }}
      >
        <span
          style={{
            fontWeight: 600,
            color: 'var(--text-muted)',
            fontSize: 11,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}
        >
          目录 ({headings.length})
        </span>
        <button
          type="button"
          onClick={onToggle}
          title="收起目录"
          aria-label="收起目录"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            fontSize: 12,
            padding: '0 4px',
          }}
        >
          ◀
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: '6px 8px 8px 12px' }}>
        {headings.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>暂无标题</div>
        )}

        {headings.map((h, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSelect(h.line)}
            title={`跳到第 ${h.line + 1} 行`}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              border: 'none',
              background: 'transparent',
              padding: '3px 6px',
              paddingLeft: 6 + (h.level - 1) * 12,
              borderRadius: 3,
              cursor: 'pointer',
              color: 'var(--text, #111)',
              fontSize: h.level === 1 ? 13 : 12,
              fontWeight: h.level === 1 ? 600 : 400,
              lineHeight: 1.5,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--hover, #e5e7eb)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            {h.text}
          </button>
        ))}
      </div>
    </nav>
  );
}
