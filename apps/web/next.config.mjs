/** @type {import('next').NextConfig} */
const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@siaga/core'],
  // Di produksi Nginx meneruskan /api ke Fastify. Rewrite ini untuk pengembangan
  // dan sebagai cadangan bila Next.js diakses langsung.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/geo/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }] },
    ];
  },
};

export default nextConfig;
