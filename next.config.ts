import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * The headers the host used to add and this one does not. HSTS was served by
   * the old platform and was lost in the move; it belongs in the application
   * so it survives the next move too. The rest are the cheap ones: no MIME
   * sniffing, no framing, and a referrer policy that does not leak a path to
   * another site. Nothing here is a substitute for the policy gate — these
   * only govern how a browser treats the answer.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
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
