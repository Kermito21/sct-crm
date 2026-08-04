import { loadRootEnv } from "@crm/env";
import type { NextConfig } from "next";

loadRootEnv();

const apiUrl =
	process.env.API_URL ??
	process.env.NEXT_PUBLIC_API_URL ??
	"http://localhost:3001";

const nextConfig: NextConfig = {
	env: {
		NEXT_PUBLIC_API_URL: apiUrl,
	},

	transpilePackages: ["@crm/auth", "@crm/db", "@crm/ui"],

	serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],

	images: {
		remotePatterns: [
			{ protocol: "https", hostname: "**.blob.vercel-storage.com" },
		],
	},

	experimental: {
		viewTransition: true,
	},
};

export default nextConfig;

// Deploy note: set NEXT_PUBLIC_API_URL on the Vercel project (not just
// API_URL) - the app's turbo build task only admits the NEXT_PUBLIC_ name,
// so API_URL alone bakes the localhost fallback into the bundle.
