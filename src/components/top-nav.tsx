import Link from 'next/link';
import { SearchBar } from './search-bar';
import { QuickLog } from './quick-log';

export function TopNav({ contacts }: { contacts: { id: string; name: string }[] }) {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-4 p-3">
        <Link href="/" className="font-bold text-lg">PRM</Link>
        <nav className="flex gap-3 text-sm text-gray-700">
          <Link href="/today" className="hover:text-accent">今天</Link>
          <Link href="/contacts" className="hover:text-accent">联系人</Link>
          <Link href="/calendar" className="hover:text-accent">日程</Link>
          <Link href="/actions" className="hover:text-accent">Action</Link>
          <Link href="/needs" className="hover:text-accent">需求</Link>
          <Link href="/search" className="hover:text-accent">搜索</Link>
          <Link href="/tags" className="hover:text-accent">标签</Link>
          <Link href="/inbox" className="hover:text-accent">收件箱</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <SearchBar />
          <QuickLog contacts={contacts} />
        </div>
      </div>
    </header>
  );
}
