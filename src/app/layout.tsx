import './globals.css';
import type { Metadata } from 'next';
import { TopNav } from '@/components/top-nav';
import { auth } from '@/auth';
import { getCurrentUser } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'PRM · 人脉管理',
  description: '联系人、日程、需求一站式管理',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.IS_DESKTOP === 'true') {
    const user = await getCurrentUser();
    return (
      <html lang="zh-CN">
        <body>
          <TopNav
            currentUser={{
              name: user.name,
              email: user.email,
              image: user.image,
            }}
          />
          {children}
        </body>
      </html>
    );
  }

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
