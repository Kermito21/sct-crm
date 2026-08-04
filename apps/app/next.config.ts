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

// Cache-bust 2026-08-04: first Vercel build ran before API_URL existed and its
// inlined localhost fallback survived through cached rebuilds; config change
// forces a clean compile.
