import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Turbopack is the default in Next 16; config lives at the top level now.
  turbopack: {},
};

export default nextConfig;
