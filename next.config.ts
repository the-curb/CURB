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
    // The front page's stage line is derived from the treasury's evidence file.
    '/': ['./contracts/evidence/safes/safe.4663.json'],
    '/services': ['./contracts/evidence/safes/safe.4663.json'],
    '/doctrine': ['./DOCTRINE.md'],
    '/mechanism': ['./MECHANISM.md'],
    '/mechanism/decisions/**': ['./docs/decisions/*.md'],
    '/positions/**': ['./contracts/evidence/*.json'],
    '/api/positions/**': ['./contracts/evidence/*.json'],
    '/api/status': ['./contracts/evidence/*.json'],
    // The tick verifies deployed code against the committed builds.
    '/api/tick': ['./contracts/evidence/*.json'],
  },
};

export default nextConfig;
