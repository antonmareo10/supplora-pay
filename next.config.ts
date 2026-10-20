import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The official PayPal Agent Toolkit (and the MCP SDK it shares with us) run as plain Node
  // packages on the server instead of being bundled.
  serverExternalPackages: ["@paypal/agent-toolkit", "@modelcontextprotocol/sdk"],
  // The review route reads the bundled sample invoices from disk (and checks them against the
  // recorded readings in demo mode): ship them with the serverless functions (Vercel).
  outputFileTracingIncludes: {
    "/api/documents/**": ["./public/samples/**/*"],
  },
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
