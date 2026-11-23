import type { NextConfig } from "next";

const SERVER_PORT = process.env.SERVER_PORT || "6869";

const nextConfig: NextConfig = {

  env: {
    NEXT_PUBLIC_SERVER_PORT:
      process.env.SERVER_PORT ?? process.env.NEXT_PUBLIC_SERVER_PORT ?? "6869",
  },

  devIndicators: {
    position: "bottom-right",
  },
  experimental: {

    proxyTimeout: 10 * 60 * 1000,

    proxyClientMaxBodySize: 2 * 1024 * 1024 * 1024,
  },

  async headers() {
    return [

      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },

          { key: "Referrer-Policy", value: "same-origin" },

          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://127.0.0.1:${SERVER_PORT}/api/:path*`,
      },
      {
        source: "/media/:path*",
        destination: `http://127.0.0.1:${SERVER_PORT}/media/:path*`,
      },
    ];
  },
};

export default nextConfig;
