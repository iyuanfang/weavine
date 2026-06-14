import './globals.css';
import type { Metadata } from 'next';
import { Providers } from './providers';
import { TopNav } from '@/components/top-nav';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'PRM · 人脉管理',
  description: '联系人、日程、需求一站式管理',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>
          <TopNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
