/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/json-to-sqlite',
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    return config;
  },
};

module.exports = nextConfig;
