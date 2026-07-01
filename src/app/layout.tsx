import './globals.css';
import type { Metadata } from 'next';
import { TopNav } from '@/components/top-nav';
import { auth } from '@/auth';
import { getCurrentUser } from '@/lib/auth/session';
import { ErrorBoundaryFallback } from '@/components/error-boundary-fallback';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'PRM · 人脉管理',
  description: '联系人、日程、需求一站式管理',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    if (process.env.IS_DESKTOP === 'true') {
      // Don't block render on Prisma — TopNav renders with placeholder
      // and the user info arrives once the server-side warmup completes.
      return (
        <html lang="zh-CN">
          <body>
            <TopNav isDesktop />
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : '应用初始化失败';
    return (
      <html lang="zh-CN">
        <body>
          <ErrorBoundaryFallback message={msg} />
        </body>
      </html>
    );
  }
}
