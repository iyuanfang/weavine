/** @type {import('next').NextConfig} */
const allowedOrigins = (process.env.NEXT_SERVER_ALLOWED_ORIGINS ?? 'localhost:3000,localhost:3100')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { allowedOrigins } },
};
export default nextConfig;
