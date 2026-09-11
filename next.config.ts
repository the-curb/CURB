import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Turbopack is the default in Next 16; config lives at the top level now.
  turbopack: {},
  // The doctrine page reads DOCTRINE.md from disk at request time so the site
  // cannot drift from the document. A serverless trace does not see a dynamic
  // fs.readFile, so the file is named here or it is absent in production.
  outputFileTracingIncludes: {
    '/doctrine': ['./DOCTRINE.md'],
  },
};

export default nextConfig;
