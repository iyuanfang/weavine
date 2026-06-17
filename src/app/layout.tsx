import './globals.css';
import type { Metadata } from 'next';
import { TopNav } from '@/components/top-nav';
import { ContactService } from '@/server/services/contact';

export const metadata: Metadata = {
  title: 'PRM · 人脉管理',
  description: '联系人、日程、需求一站式管理',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const contacts = (await ContactService.list({})).map((c) => ({
    id: c.id,
    name: c.name,
  }));
  return (
    <html lang="zh-CN">
      <body>
        <TopNav contacts={contacts} />
        {children}
      </body>
    </html>
  );
}
