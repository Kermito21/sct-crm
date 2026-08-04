// Imported for Vercel's NestJS entrypoint detection, which looks for
// @nestjs/core in the entry file; NestFactory itself lives in create-app.ts.
import "@nestjs/core";

import { Logger } from "@nestjs/common";
import { createApp } from "./create-app";

async function bootstrap() {
	const app = await createApp();
	app.enableShutdownHooks();

	const port = process.env.PORT ?? 3001;
	await app.listen(port);

	new Logger("Bootstrap").log({
		message: `API listening on http://localhost:${port}`,
		port: Number(port),
		environment: process.env.NODE_ENV ?? "development",
	});
}

void bootstrap().catch((error: unknown) => {
	new Logger("Bootstrap").fatal(
		{ message: "API failed to start" },
		error instanceof Error ? error.stack : String(error),
	);
	process.exit(1);
});
