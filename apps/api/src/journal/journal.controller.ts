import {
	All,
	Controller,
	Req,
	Res,
	ServiceUnavailableException,
} from "@nestjs/common";
import type { Request, Response } from "express";

const JOURNAL_URL = process.env.JOURNAL_URL ?? "https://app.sctsuite.com";
const JOURNAL_ADMIN_TOKEN = process.env.JOURNAL_ADMIN_TOKEN ?? "";

@Controller("api/journal/admin")
export class JournalController {
	@All("*")
	async forward(@Req() req: Request, @Res() res: Response) {
		if (!JOURNAL_ADMIN_TOKEN) {
			throw new ServiceUnavailableException("Journal proxy not configured");
		}

		const suffix = req.originalUrl.replace(/^.*?\/api\/journal\/admin/, "");
		const target = `${JOURNAL_URL}/api/admin${suffix}`;

		const headers: Record<string, string> = {
			"x-service-token": JOURNAL_ADMIN_TOKEN,
		};
		const contentType = req.headers["content-type"];
		if (typeof contentType === "string") headers["content-type"] = contentType;

		const hasBody = req.method !== "GET" && req.method !== "HEAD";
		const upstream = await fetch(target, {
			method: req.method,
			headers,
			body: hasBody && req.body ? JSON.stringify(req.body) : undefined,
		});

		const text = await upstream.text();
		res
			.status(upstream.status)
			.type(upstream.headers.get("content-type") ?? "application/json")
			.send(text);
	}
}
