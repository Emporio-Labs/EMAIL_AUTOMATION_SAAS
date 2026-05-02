import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Ensure Turbopack resolves the workspace root to the dashboard app
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
