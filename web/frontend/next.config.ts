import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@haven/backend"],
  // Static files for Firebase Hosting (`npm run build` writes them to `out/`).
  // `npm run dev` is unaffected. The old /reflection address is handled by
  // app/reflection/page.tsx and by the redirect in firebase.json.
  output: "export",
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
