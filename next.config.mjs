/** @type {import('next').NextConfig} */
const allowedOrigins = (process.env.NEXT_SERVER_ALLOWED_ORIGINS ?? 'localhost:3000,localhost:3100')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const isDesktop = process.env.IS_DESKTOP === "true";

const nextConfig = {
  reactStrictMode: true,
  output: isDesktop ? 'standalone' : undefined,
  experimental: {
    serverActions: isDesktop ? undefined : { allowedOrigins },
    staleTimes: {
      dynamic: 0,
      static: 180,
    },
  },
  images: isDesktop ? { unoptimized: true } : undefined,
};
export default nextConfig;
