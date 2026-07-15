/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@stellar/stellar-sdk'],
    // v1.1: Enable server actions once we need them
  },
  // Allow Stellar SDK to work in server components
}

export default nextConfig
