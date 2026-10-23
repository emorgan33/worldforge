import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The CLI checker requires a spawned tsc process; the compiler API keeps
    // production builds compatible with restricted process environments.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
