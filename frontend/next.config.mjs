/** @type {import('next').NextConfig} */
const config = {
  async rewrites() {
    const proxyOrigin = process.env.API_PROXY_ORIGIN;
    if (!proxyOrigin) {
      if (process.env.NEXT_PUBLIC_API_BASE_URL === "/api/v1") {
        throw new Error("API_PROXY_ORIGIN is required for the same-origin API");
      }
      return [];
    }
    const target = new URL(proxyOrigin);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username || target.password || target.pathname !== "/" ||
      target.search || target.hash
    ) {
      throw new Error("API_PROXY_ORIGIN must be an HTTP(S) origin without credentials or a path");
    }
    if (process.env.NEXT_PUBLIC_API_BASE_URL !== "/api/v1") {
      throw new Error("Set NEXT_PUBLIC_API_BASE_URL=/api/v1 when API_PROXY_ORIGIN is configured");
    }
    // Keep NextAuth /api/auth on Next; only the existing public API goes to BE.
    return [{ source: "/api/v1/:path*", destination: `${target.origin}/api/v1/:path*` }];
  },
};

export default config;
