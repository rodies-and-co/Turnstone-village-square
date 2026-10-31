import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Vault uploads go through the server and can be up to 25 MB.
    serverActions: { bodySizeLimit: "26mb" },
  },
};

export default nextConfig;
