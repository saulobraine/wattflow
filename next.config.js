/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    viewTransition: true,
  },
}

module.exports = nextConfig
