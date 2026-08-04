import type { Db } from "@crm/db";
import {
	Body,
	Controller,
	Headers,
	HttpCode,
	Logger,
	Post,
	ServiceUnavailableException,
	UnauthorizedException,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { blankToNull, normalizeEmail } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";

interface IngestLeadBody {
	email?: string;
	firstName?: string;
	lastName?: string;
	phone?: string;
	funnel?: string;
	formName?: string;
	sourceUrl?: string;
}

interface IngestEventBody {
	email?: string;
	kind?: string;
	detail?: string;
	occurredAt?: string;
}

/** Fixed author for machine-recorded activities (journal event sync). */
const SYSTEM_USER_ID = "sct-system-events";

/**
 * Machine lead intake for the SCT funnel (learn.sctsuite.com/api/lead) and the
 * one-off historical import. Deliberately dumb, per docs/api.md: find-or-create
 * the contact row, then report that it happened by enqueuing the same
 * contact-created task the rest of the API uses — the agent decides what the
 * lead means. Guarded by the CRM_INGEST_SECRET header, not a session, because
 * the caller is a server. Idempotent on email so funnel resubmits are safe.
 */
@Controller("ingest")
export class IngestController {
	private readonly logger = new Logger(IngestController.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agentTrigger: AgentTriggerService,
	) {}

	@Post("lead")
	@HttpCode(200)
	@AllowAnonymous()
	async lead(
		@Headers("x-ingest-secret") secret: string | undefined,
		@Body() body: IngestLeadBody,
	) {
		const expected = process.env.CRM_INGEST_SECRET ?? "";
		if (!expected) throw new ServiceUnavailableException("Ingest not configured");
		if (secret !== expected) throw new UnauthorizedException();

		const email = normalizeEmail(body.email ?? "");
		if (!email) return { ok: false, error: "email required" };

		const existing = await this.db.contact.findFirst({
			where: { email: { equals: email, mode: "insensitive" } },
			select: { id: true },
		});
		if (existing) {
			this.logger.log({ message: "Ingest lead already known", contactId: existing.id });
			return { ok: true, contactId: existing.id, existing: true };
		}

		const firstName =
			blankToNull(body.firstName ?? "") ?? email.split("@")[0] ?? "Unknown";

		const contact = await this.db.contact.create({
			data: {
				firstName,
				lastName: blankToNull(body.lastName ?? ""),
				email,
				phone: blankToNull(body.phone ?? ""),
			},
			select: { id: true },
		});

		const source = [body.funnel, body.formName].filter(Boolean).join(" / ");
		await this.agentTrigger.contactCreated(
			contact.id,
			source ? `Funnel opt-in (${source})` : "Funnel opt-in",
		);

		this.logger.log({ message: "Ingest lead created", contactId: contact.id });
		return { ok: true, contactId: contact.id, existing: false };
	}

	/**
	 * Journal → CRM event sync (SCT dashboard pushes lifecycle signals:
	 * application approved, app account created, broker connected, …).
	 * Records a NOTE activity on the contact's timeline, creating the
	 * contact if the email is new. Same secret and idempotency posture as
	 * /ingest/lead; the activity author is a fixed system user.
	 */
	@Post("event")
	@HttpCode(200)
	@AllowAnonymous()
	async event(
		@Headers("x-ingest-secret") secret: string | undefined,
		@Body() body: IngestEventBody,
	) {
		const expected = process.env.CRM_INGEST_SECRET ?? "";
		if (!expected) throw new ServiceUnavailableException("Ingest not configured");
		if (secret !== expected) throw new UnauthorizedException();

		const email = normalizeEmail(body.email ?? "");
		const kind = (body.kind ?? "").trim();
		if (!email || !kind) return { ok: false, error: "email and kind required" };

		let contact = await this.db.contact.findFirst({
			where: { email: { equals: email, mode: "insensitive" } },
			select: { id: true },
		});
		if (!contact) {
			contact = await this.db.contact.create({
				data: { firstName: email.split("@")[0] ?? "Unknown", email },
				select: { id: true },
			});
			await this.agentTrigger.contactCreated(contact.id, `Journal event (${kind})`);
		}

		await this.db.user.upsert({
			where: { id: SYSTEM_USER_ID },
			update: {},
			create: {
				id: SYSTEM_USER_ID,
				name: "SCT Systems",
				email: "systems@sctsuite.com",
			},
		});

		const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
		await this.db.activity.create({
			data: {
				type: "NOTE",
				subject: kind,
				body: blankToNull(body.detail ?? ""),
				occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
				contactId: contact.id,
				createdById: SYSTEM_USER_ID,
			},
		});

		this.logger.log({ message: "Ingest event recorded", contactId: contact.id, kind });
		return { ok: true, contactId: contact.id };
	}
}
