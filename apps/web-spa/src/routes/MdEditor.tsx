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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { renderMarkdown } from '../lib/markdown';

export function MdEditor() {
  const adapter = useAdapter();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const path = params.get('path');
  const [content, setContent] = useState('');
  const [, setOriginalMtime] = useState<number | null>(null);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [encoding, setEncoding] = useState('');
  const [view, setView] = useState<'edit' | 'preview' | 'split'>('split');
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
        setInfo(`✓ 已导入库 (${r.action})`);
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
      setInfo(`✓ ${r.action} (${r.note_id.slice(0, 8)}…)`);
    } catch (e) {
      setError(`导入失败: ${String(e)}`);
    }
  }, [adapter, content, path, userId]);

  const largeFile = sizeBytes > 1_048_576;
  const banner = largeFile
    ? `文件较大 (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB)，可能影响性能；导入库按钮已禁用`
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
        <select
          value={view}
          onChange={(e) => setView(e.target.value as 'edit' | 'preview' | 'split')}
          style={{ padding: '4px 6px', borderRadius: 4 }}
        >
          <option value="split">分屏</option>
          <option value="edit">仅编辑</option>
          <option value="preview">仅预览</option>
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={importToLibrary}
          disabled={!path || !userId || largeFile}
          title={!userId ? '需要本地用户' : largeFile ? '文件 > 1 MB 不可入库' : '复制内容到笔记库'}
        >
          📥 导入库
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

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {(view === 'edit' || view === 'split') && (
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
            }}
            placeholder={path ? '' : '点「📂 打开 .md」选择本地 Markdown 文件…'}
          />
        )}
        {(view === 'preview' || view === 'split') && (
          <div
            style={{
              flex: 1,
              padding: '12px 20px',
              overflow: 'auto',
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
