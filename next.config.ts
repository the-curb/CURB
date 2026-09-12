import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Turbopack is the default in Next 16; config lives at the top level now.
  turbopack: {},
  // Pages that read a file from the repository at request time — so the site
  // cannot drift from the document — must name the file here: a serverless
  // trace does not see a dynamic fs.readFile, and an unnamed file is absent
  // in production. The page then says so rather than showing a copy, which
  // is right, but the file being present is better.
  outputFileTracingIncludes: {
    '/doctrine': ['./DOCTRINE.md'],
    '/mechanism': ['./MECHANISM.md'],
    '/mechanism/decisions/**': ['./docs/decisions/*.md'],
    '/positions/**': ['./contracts/evidence/*.json'],
    '/api/positions/**': ['./contracts/evidence/*.json'],
    '/api/status': ['./contracts/evidence/*.json'],
  },
};

export default nextConfig;
