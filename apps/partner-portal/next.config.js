/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['recharts'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
  },
};

module.exports = nextConfig;
