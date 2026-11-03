import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: [
    "@aivideo/contracts",
    "@aivideo/core",
    "@aivideo/db",
    "@aivideo/server",
    "@aivideo/providers",
    "@aivideo/studio-ui",
    "@aivideo/workflow-ui",
  ],
  serverExternalPackages: ["pg-boss", "postgres"],
  poweredByHeader: false,
};
export default config;
