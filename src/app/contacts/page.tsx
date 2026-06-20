import { Suspense } from 'react';
import Link from 'next/link';
import { ContactService } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
import { ContactCard } from '@/components/contact-card';
import { readSettings } from '@/app/settings/actions';
import { getCurrentUser } from '@/lib/auth/session';
import { ContactsToolbar } from './contacts-toolbar';

function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function contactsHref(searchParams: { q?: string; tag?: string; sort?: string }, page: number): string {
  const params = new URLSearchParams();
  if (searchParams.q) params.set('q', searchParams.q);
  if (searchParams.tag) params.set('tag', searchParams.tag);
  if (searchParams.sort && searchParams.sort !== 'recent') params.set('sort', searchParams.sort);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/contacts?${qs}` : '/contacts';
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string; tag?: string; sort?: string; page?: string };
}) {
  const { id: ownerId } = await getCurrentUser();
  const page = parsePage(searchParams.page);
  const sort = (searchParams.sort ?? 'recent') as 'recent' | 'importance' | 'name';
  const [contactsPage, tags, settings] = await Promise.all([
    ContactService.listPage({
      q: searchParams.q,
      tagId: searchParams.tag,
      ownerId,
      page,
      sort,
    }),
    TagService.list(ownerId),
    readSettings(),
  ]);
  const { items: list, total, totalPages } = contactsPage;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">联系人</h1>
        <Link href="/contacts/new" className="btn-primary">新建</Link>
      </div>

      <Suspense fallback={<div className="mt-4 h-10" />}>
        <ContactsToolbar tags={tags} />
      </Suspense>

      <div className="mt-4 text-sm text-gray-500">
        共 {total} 位联系人{totalPages > 1 ? ` · 第 ${contactsPage.page} / ${totalPages} 页` : ''}
      </div>

      <ul className="mt-3 grid gap-2">
        {list.length === 0 ? (
          <li className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">还没有联系人。从一个你最近见过的人开始：</p>
            <ol className="mx-auto mt-3 max-w-md space-y-2 text-left text-sm text-gray-700">
              <li><span className="font-medium text-accent">1.</span> 点右上角「新建」，写下他的昵称（不知道怎么称呼就写微信名）</li>
              <li><span className="font-medium text-accent">2.</span> 给他打个标签（朋友/同事/投资人…默认标签已生成）</li>
              <li><span className="font-medium text-accent">3.</span> 在联系人详情里加一条互动 —— 下次想起他就不会断了</li>
            </ol>
            <Link href="/contacts/new" className="btn-primary mt-4 inline-block">+ 添加第一个联系人</Link>
          </li>
        ) : (
          list.map((c) => (
            <ContactCard key={c.id} contact={c} thresholds={settings.staleDays} />
          ))
        )}
      </ul>

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="联系人分页">
          {contactsPage.page > 1 ? (
            <Link className="btn-secondary" href={contactsHref(searchParams, contactsPage.page - 1)}>
              上一页
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-50">上一页</span>
          )}
          <span className="text-gray-500">
            第 {contactsPage.page} / {totalPages} 页
          </span>
          {contactsPage.page < totalPages ? (
            <Link className="btn-secondary" href={contactsHref(searchParams, contactsPage.page + 1)}>
              下一页
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-50">下一页</span>
          )}
        </nav>
      )}
    </main>
  );
}
