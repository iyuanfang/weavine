/**
 * The `.md` file the editor edits when the user opens a non-`.md` source
 * (docx / pdf / html / xlsx / pptx / txt). It sits next to the original so
 * related files stay together; the original is never modified.
 *
 * Shared by the OS "Open With" / argv path (App.tsx) and the in-app "📂 打开"
 * dialog (MdEditor.tsx, NotesList.tsx). These used to compute it independently
 * and drifted: the dialogs would route the original binary into the editor
 * which decodes a .docx (a ZIP archive) as text and crashes CodeMirror. One
 * implementation means one behaviour for every entry point.
 */
export function siblingMdPath(originalPath: string): string {
  const dot = originalPath.lastIndexOf('.');
  const slash = Math.max(
    originalPath.lastIndexOf('/'),
    originalPath.lastIndexOf('\\'),
  );
  // Only treat `dot` as an extension separator when it follows the last path
  // separator — otherwise a path like `C:\dir.name\file` would be truncated.
  return dot > slash
    ? originalPath.slice(0, dot) + '.md'
    : originalPath + '.md';
}

const MD_EXTS = new Set(['md', 'markdown']);

/**
 * Build the `/md-editor?…` URL the router should navigate to for an opened
 * file. Centralises what used to be three diverging copies (App.tsx argv,
 * MdEditor's in-app dialog, NotesList's "📂 打开文件" button).
 *
 * - `.md` / `.markdown`: edit the file directly.
 * - Anything else (docx / pdf / html / xlsx / pptx / txt): edit the sibling
 *   `.md`, pass the original as `external_path` so MdEditor invokes
 *   `convert_external_file` rather than reading the binary as UTF-8.
 *
 * Without the `external_path` branch a .docx is read as a string and freezes
 * CodeMirror — see commit `b5bbddb` ("reject binary containers") for the
 * matching backend fix.
 */
export function mdEditorUrl(originalPath: string): string {
  const lower = originalPath.toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop()! : '';
  if (MD_EXTS.has(ext)) {
    return `/md-editor?path=${encodeURIComponent(originalPath)}`;
  }
  const sibling = siblingMdPath(originalPath);
  return `/md-editor?path=${encodeURIComponent(sibling)}&external_path=${encodeURIComponent(originalPath)}`;
}
