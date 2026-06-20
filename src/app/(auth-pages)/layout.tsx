export const metadata = {
  title: 'PRM · 登录',
  description: '登录到 PRM',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Route-group layout — root layout provides <html>/<body>.
  return <>{children}</>;
}
