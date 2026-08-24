import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { renderMarkdown } from '../lib/markdown';

interface Props {
  body: string;
}

export function MarkdownView({ body }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const html = renderMarkdown(body);
  const navigate = useNavigate();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const links = root.querySelectorAll<HTMLAnchorElement>('a.wikilink');
    const handlers = Array.from(links).map((a) => {
      const handler = (e: MouseEvent) => {
        e.preventDefault();
        const href = a.getAttribute('href') ?? '';
        if (href.startsWith('#/')) navigate(href.slice(1));
      };
      a.addEventListener('click', handler);
      return { a, handler };
    });
    return () => {
      for (const { a, handler } of handlers) a.removeEventListener('click', handler);
    };
  }, [html, navigate]);

  return (
    <div
      ref={ref}
      className="markdown-view"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}