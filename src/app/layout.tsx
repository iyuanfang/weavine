import './globals.css';
import type { Metadata, Viewport } from 'next';
import { TopNav } from '@/components/top-nav';
import { auth } from '@/auth';
import { RegisterSW } from '@/components/register-sw';

export const metadata: Metadata = {
  title: 'PRM · 人脉管理',
  description: '联系人、日程、需求一站式管理',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
      <body>
        {children}
        <RegisterSW />
      </body>
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
        <RegisterSW />
      </body>
    </html>
  );
}
