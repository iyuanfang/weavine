import './globals.css';
import type { Metadata } from 'next';
import { TopNav } from '@/components/top-nav';
import { auth } from '@/auth';

export const metadata: Metadata = {
  title: 'PRM · 人脉管理',
  description: '联系人、日程、需求一站式管理',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <html lang="zh-CN">
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html lang="zh-CN">
      <body>
        <TopNav
          currentUser={{
            name: session.user.name ?? null,
            email: session.user.email ?? null,
            image: session.user.image ?? null,
          }}
        />
        {children}
      </body>
    </html>
  );
}
