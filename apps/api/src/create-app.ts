import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
	ExpressAdapter,
	type NestExpressApplication,
} from "@nestjs/platform-express";
import type { RequestHandler } from "express";
import * as helmetImport from "helmet";
import { AppModule } from "./app.module";

// helmet is CJS; whether the callable arrives as the namespace itself or on
// .default depends on the compiler's interop settings (local bun tsc and
// Vercel's nestjs preset disagree). Resolve at runtime, type it plainly.
const helmet = ((helmetImport as unknown as { default?: unknown }).default ??
	helmetImport) as () => RequestHandler;
import { ContextLogger } from "./logging/context-logger";

export async function createApp(): Promise<NestExpressApplication> {
	const app = await NestFactory.create<NestExpressApplication>(
		AppModule,
		new ExpressAdapter(),
		{ bodyParser: false, logger: new ContextLogger() },
	);

	app.use(helmet());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
			transformOptions: { enableImplicitConversion: true },
		}),
	);

	return app;
}
