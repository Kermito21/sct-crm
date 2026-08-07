import { type Db, DealStage } from "@crm/db";
import {
	Body,
	Controller,
	Get,
	Headers,
	HttpCode,
	Logger,
	Post,
	Query,
	ServiceUnavailableException,
	UnauthorizedException,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { blankToNull, normalizeEmail } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { isClosedStage } from "../deals/deal-stage";

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

interface IngestSaleFollowUp {
	subject?: string;
	dueAt?: string;
	notes?: string;
}

interface IngestSaleBody {
	email?: string;
	firstName?: string;
	lastName?: string;
	phone?: string;
	company?: string;
	dealName?: string;
	amount?: number | string;
	currency?: string;
	stage?: string;
	notes?: string;
	fathomUrl?: string;
	occurredAt?: string;
	ownerEmail?: string;
	followUps?: IngestSaleFollowUp[];
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
		if (!expected)
			throw new ServiceUnavailableException("Ingest not configured");
		if (secret !== expected) throw new UnauthorizedException();

		const email = normalizeEmail(body.email ?? "");
		if (!email) return { ok: false, error: "email required" };

		const existing = await this.db.contact.findFirst({
			where: { email: { equals: email, mode: "insensitive" } },
			select: { id: true },
		});
		if (existing) {
			this.logger.log({
				message: "Ingest lead already known",
				contactId: existing.id,
			});
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
		if (!expected)
			throw new ServiceUnavailableException("Ingest not configured");
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
			await this.agentTrigger.contactCreated(
				contact.id,
				`Journal event (${kind})`,
			);
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
				occurredAt: Number.isNaN(occurredAt.getTime())
					? new Date()
					: occurredAt,
				contactId: contact.id,
				createdById: SYSTEM_USER_ID,
			},
		});

		this.logger.log({
			message: "Ingest event recorded",
			contactId: contact.id,
			kind,
		});
		return { ok: true, contactId: contact.id };
	}

	/**
	 * One post from a closed sales call writes the whole record: the contact,
	 * the company row a Deal requires (deals are company-scoped here, so an
	 * individual buyer gets a company named after them), the deal with amount
	 * and stage, a CALL activity carrying the notes and Fathom link, and TASK
	 * activities for the follow-ups. Idempotent on deal name per contact and
	 * on open task subject, so a retry cannot double-count the pipeline: an
	 * existing deal skips both the deal and the call, an open task with the
	 * same subject skips that task.
	 */
	@Post("sale")
	@HttpCode(200)
	@AllowAnonymous()
	async sale(
		@Headers("x-ingest-secret") secret: string | undefined,
		@Body() body: IngestSaleBody,
	) {
		const expected = process.env.CRM_INGEST_SECRET ?? "";
		if (!expected)
			throw new ServiceUnavailableException("Ingest not configured");
		if (secret !== expected) throw new UnauthorizedException();

		const email = normalizeEmail(body.email ?? "");
		const dealName = blankToNull(body.dealName ?? "");
		if (!email || !dealName) {
			return { ok: false, error: "email and dealName required" };
		}

		const stageKey = (body.stage ?? "")
			.trim()
			.toUpperCase()
			.replace(/[\s-]+/g, "_");
		const stage = (Object.values(DealStage) as string[]).includes(stageKey)
			? (stageKey as DealStage)
			: DealStage.CLOSED_WON;

		const parsedAmount =
			body.amount === undefined ? Number.NaN : Number(body.amount);
		const amount = Number.isFinite(parsedAmount) ? parsedAmount : null;

		const now = new Date();
		const parsedOccurredAt = body.occurredAt ? new Date(body.occurredAt) : now;
		const callAt = Number.isNaN(parsedOccurredAt.getTime())
			? now
			: parsedOccurredAt;

		let contact = await this.db.contact.findFirst({
			where: { email: { equals: email, mode: "insensitive" } },
			select: { id: true, firstName: true, lastName: true, companyId: true },
		});
		const contactExisting = contact !== null;
		if (!contact) {
			const firstName =
				blankToNull(body.firstName ?? "") ?? email.split("@")[0] ?? "Unknown";
			contact = await this.db.contact.create({
				data: {
					firstName,
					lastName: blankToNull(body.lastName ?? ""),
					email,
					phone: blankToNull(body.phone ?? ""),
				},
				select: { id: true, firstName: true, lastName: true, companyId: true },
			});
		}

		const companyName =
			blankToNull(body.company ?? "") ??
			[contact.firstName, contact.lastName].filter(Boolean).join(" ");
		let company = await this.db.company.findFirst({
			where: { name: { equals: companyName, mode: "insensitive" } },
			select: { id: true },
		});
		if (!company) {
			company = await this.db.company.create({
				data: { name: companyName },
				select: { id: true },
			});
		}
		if (!contact.companyId) {
			await this.db.contact.update({
				where: { id: contact.id },
				data: { companyId: company.id },
			});
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
		const ownerEmail = normalizeEmail(body.ownerEmail ?? "");
		const owner = ownerEmail
			? await this.db.user.findFirst({
					where: { email: { equals: ownerEmail, mode: "insensitive" } },
					select: { id: true },
				})
			: null;
		const authorId = owner?.id ?? SYSTEM_USER_ID;

		let deal = await this.db.deal.findFirst({
			where: {
				name: { equals: dealName, mode: "insensitive" },
				contacts: { some: { contactId: contact.id } },
			},
			select: { id: true },
		});
		const dealExisting = deal !== null;
		if (!deal) {
			deal = await this.db.deal.create({
				data: {
					name: dealName,
					companyId: company.id,
					ownerId: authorId,
					stage,
					stageChangedAt: now,
					closedAt: isClosedStage(stage) ? callAt : null,
					amount,
					currency: blankToNull(body.currency ?? "") ?? "USD",
					lastActivityAt: callAt,
					contacts: { create: { contactId: contact.id } },
				},
				select: { id: true },
			});

			const callBody = [
				blankToNull(body.notes ?? ""),
				blankToNull(body.fathomUrl ?? ""),
			]
				.filter(Boolean)
				.join("\n\n");
			await this.db.activity.create({
				data: {
					type: "CALL",
					subject: `Sales call: ${dealName}`,
					body: callBody === "" ? null : callBody,
					occurredAt: callAt,
					companyId: company.id,
					contactId: contact.id,
					dealId: deal.id,
					createdById: authorId,
					...(blankToNull(body.fathomUrl ?? "")
						? { meta: { fathomUrl: body.fathomUrl } }
						: {}),
				},
			});
		}

		let tasksCreated = 0;
		let tasksSkipped = 0;
		for (const followUp of body.followUps ?? []) {
			const subject = blankToNull(followUp.subject ?? "");
			if (!subject) continue;
			const open = await this.db.activity.findFirst({
				where: {
					type: "TASK",
					completedAt: null,
					contactId: contact.id,
					subject: { equals: subject, mode: "insensitive" },
				},
				select: { id: true },
			});
			if (open) {
				tasksSkipped += 1;
				continue;
			}
			const parsedDueAt = followUp.dueAt ? new Date(followUp.dueAt) : null;
			await this.db.activity.create({
				data: {
					type: "TASK",
					subject,
					body: blankToNull(followUp.notes ?? ""),
					dueAt:
						parsedDueAt && !Number.isNaN(parsedDueAt.getTime())
							? parsedDueAt
							: null,
					companyId: company.id,
					contactId: contact.id,
					dealId: deal.id,
					createdById: authorId,
				},
			});
			tasksCreated += 1;
		}

		await this.db.contact.update({
			where: { id: contact.id },
			data: { lastActivityAt: callAt },
		});
		await this.db.company.update({
			where: { id: company.id },
			data: { lastActivityAt: callAt },
		});

		if (!contactExisting) {
			await this.agentTrigger.contactCreated(
				contact.id,
				`Sale ingest (${dealName})`,
			);
		}

		this.logger.log({
			message: "Ingest sale recorded",
			contactId: contact.id,
			dealId: deal.id,
			dealExisting,
			tasksCreated,
			tasksSkipped,
		});
		return {
			ok: true,
			contactId: contact.id,
			companyId: company.id,
			dealId: deal.id,
			dealExisting,
			tasksCreated,
			tasksSkipped,
		};
	}

	/**
	 * Open follow-up tasks that are due inside a window (default 24 hours,
	 * overdue included), so a cron box can actually nag about them. A task
	 * nobody is shown is not a reminder. Same secret guard as the other
	 * ingest routes; read-only.
	 */
	@Get("tasks/due")
	@AllowAnonymous()
	async tasksDue(
		@Headers("x-ingest-secret") secret: string | undefined,
		@Query("withinHours") withinHours: string | undefined,
	) {
		const expected = process.env.CRM_INGEST_SECRET ?? "";
		if (!expected)
			throw new ServiceUnavailableException("Ingest not configured");
		if (secret !== expected) throw new UnauthorizedException();

		const parsedHours = Number(withinHours ?? "24");
		const horizonHours =
			Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 24;
		const until = new Date(Date.now() + horizonHours * 3_600_000);

		const tasks = await this.db.activity.findMany({
			where: { type: "TASK", completedAt: null, dueAt: { lte: until } },
			orderBy: { dueAt: "asc" },
			take: 200,
			select: {
				id: true,
				subject: true,
				body: true,
				dueAt: true,
				contact: {
					select: { id: true, firstName: true, lastName: true, email: true },
				},
				deal: { select: { id: true, name: true, stage: true } },
				company: { select: { id: true, name: true } },
			},
		});

		return {
			ok: true,
			count: tasks.length,
			withinHours: horizonHours,
			tasks: tasks.map((task) => ({
				...task,
				dueAt: task.dueAt?.toISOString() ?? null,
			})),
		};
	}
}
