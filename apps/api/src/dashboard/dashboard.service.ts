import { ActivityType, type Db, DealStage } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { toCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { OPEN_DEAL_STAGES } from "../deals/deal-stage";
import type { DashboardSummaryInput } from "./dashboard.contracts";

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const TREND_MONTHS = 6;

const RATE_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short" });

function monthStart(from: Date, offset: number): Date {
	return new Date(from.getFullYear(), from.getMonth() + offset, 1);
}

function monthKey(date: Date): number {
	return date.getFullYear() * 12 + date.getMonth();
}

function dayStart(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Monday-first start of the week containing `date`. */
function weekStart(date: Date): Date {
	const start = dayStart(date);
	start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
	return start;
}

function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function parseDay(value: string | undefined): Date | null {
	if (!value) return null;
	const parsed = new Date(`${value}T00:00:00`);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

interface ResolvedRange {
	start: Date;
	end: Date;
	prevStart: Date;
	prevEnd: Date;
}

/**
 * [start, end) for the requested range plus the equal-footing comparison
 * period right before it. Calendar presets compare against the previous
 * calendar unit; custom ranges against the same number of days immediately
 * prior. A custom range with missing or inverted bounds falls back to
 * this_month rather than erroring, so a half-filled picker still renders.
 */
function resolveRange(input: DashboardSummaryInput, now: Date): ResolvedRange {
	switch (input.range) {
		case "today": {
			const start = dayStart(now);
			return {
				start,
				end: addDays(start, 1),
				prevStart: addDays(start, -1),
				prevEnd: start,
			};
		}
		case "this_week": {
			const start = weekStart(now);
			return {
				start,
				end: addDays(start, 7),
				prevStart: addDays(start, -7),
				prevEnd: start,
			};
		}
		case "last_week": {
			const end = weekStart(now);
			const start = addDays(end, -7);
			return { start, end, prevStart: addDays(start, -7), prevEnd: start };
		}
		case "last_month": {
			const start = monthStart(now, -1);
			return {
				start,
				end: monthStart(now, 0),
				prevStart: monthStart(now, -2),
				prevEnd: start,
			};
		}
		case "last_3_months": {
			const start = monthStart(now, -2);
			return {
				start,
				end: monthStart(now, 1),
				prevStart: monthStart(now, -5),
				prevEnd: start,
			};
		}
		case "this_year": {
			const start = new Date(now.getFullYear(), 0, 1);
			return {
				start,
				end: new Date(now.getFullYear() + 1, 0, 1),
				prevStart: new Date(now.getFullYear() - 1, 0, 1),
				prevEnd: start,
			};
		}
		case "custom": {
			const from = parseDay(input.from);
			const to = parseDay(input.to);
			if (from && to && from <= to) {
				const end = addDays(to, 1);
				const length = end.getTime() - from.getTime();
				return {
					start: from,
					end,
					prevStart: new Date(from.getTime() - length),
					prevEnd: from,
				};
			}
			break;
		}
		default:
			break;
	}
	const start = monthStart(now, 0);
	return {
		start,
		end: monthStart(now, 1),
		prevStart: monthStart(now, -1),
		prevEnd: start,
	};
}

@Injectable()
export class DashboardService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async summary(actingUserId: string, input: DashboardSummaryInput) {
		const mine = input.scope === "me";
		const owned = mine ? { ownerId: actingUserId } : {};

		const now = new Date();
		const range = resolveRange(input, now);
		const trendStart = monthStart(now, -(TREND_MONTHS - 1));
		const rateStart = new Date(now.getTime() - RATE_WINDOW_DAYS * DAY_MS);
		// The deal fetch has to reach back far enough for the trend chart, the
		// win-rate window, and the comparison period, whichever is oldest.
		const fetchStart = new Date(
			Math.min(
				trendStart.getTime(),
				range.prevStart.getTime(),
				rateStart.getTime(),
			),
		);

		const [
			openByStage,
			recentDeals,
			closingInRangeTotals,
			biggestOpen,
			overdueTasks,
			recentActivity,
		] = await Promise.all([
			this.db.deal.groupBy({
				by: ["stage"],
				where: { ...owned, stage: { in: [...OPEN_DEAL_STAGES] } },
				_count: { _all: true },
				_sum: { amount: true },
			}),
			this.db.deal.findMany({
				where: {
					...owned,
					OR: [
						{ createdAt: { gte: fetchStart } },
						{ closedAt: { gte: fetchStart } },
					],
				},
				select: {
					amount: true,
					stage: true,
					createdAt: true,
					closedAt: true,
				},
			}),
			this.db.deal.aggregate({
				where: {
					...owned,
					stage: { in: [...OPEN_DEAL_STAGES] },
					expectedCloseDate: { gte: range.start, lt: range.end },
				},
				_count: { _all: true },
				_sum: { amount: true },
			}),
			this.db.deal.findMany({
				where: { ...owned, stage: { in: [...OPEN_DEAL_STAGES] } },
				orderBy: [
					{ amount: { sort: "desc", nulls: "last" } },
					{ expectedCloseDate: "asc" },
				],
				take: 6,
				select: {
					id: true,
					name: true,
					stage: true,
					amount: true,
					currency: true,
					expectedCloseDate: true,
					stageChangedAt: true,
					company: {
						select: {
							id: true,
							name: true,
							iconUrl: true,
							iconDarkUrl: true,
							iconTone: true,
						},
					},
					owner: { select: OWNER_SELECT },
				},
			}),
			this.db.activity.findMany({
				where: {
					type: ActivityType.TASK,
					completedAt: null,
					dueAt: { lt: now },
					createdById: actingUserId,
				},
				orderBy: [{ dueAt: "asc" }],
				take: 10,
				select: {
					id: true,
					subject: true,
					dueAt: true,
					company: { select: { id: true, name: true } },
					deal: { select: { id: true, name: true } },
				},
			}),
			this.db.activity.findMany({
				where: mine ? { createdById: actingUserId } : {},
				orderBy: [{ createdAt: "desc" }],
				take: 12,
				select: {
					id: true,
					type: true,
					subject: true,
					body: true,
					createdAt: true,
					meta: true,
					createdBy: { select: OWNER_SELECT },
					company: { select: { id: true, name: true } },
					deal: { select: { id: true, name: true } },
				},
			}),
		]);

		const stages = OPEN_DEAL_STAGES.map((stage) => {
			const group = openByStage.find((row) => row.stage === stage);
			return {
				stage: stage as DealStage,
				count: group?._count._all ?? 0,
				valueCents: toCents(group?._sum.amount ?? null) ?? 0,
			};
		});

		const firstBucket = monthKey(trendStart);
		const trend = Array.from({ length: TREND_MONTHS }, (_, index) => ({
			month: MONTH_LABEL.format(monthStart(trendStart, index)),
			won: 0,
			created: 0,
		}));

		const wonInRange = { count: 0, valueCents: 0 };
		const wonPrevRange = { count: 0, valueCents: 0 };
		let wins = 0;
		let losses = 0;
		let wonCents = 0;
		let cycleDays = 0;

		for (const deal of recentDeals) {
			const cents = toCents(deal.amount) ?? 0;

			const created = trend[monthKey(deal.createdAt) - firstBucket];
			if (created) created.created += cents;

			const { closedAt, stage } = deal;
			if (!closedAt) continue;
			const won = stage === DealStage.CLOSED_WON;

			if (won) {
				const closed = trend[monthKey(closedAt) - firstBucket];
				if (closed) closed.won += cents;

				if (closedAt >= range.start && closedAt < range.end) {
					wonInRange.count += 1;
					wonInRange.valueCents += cents;
				} else if (closedAt >= range.prevStart && closedAt < range.prevEnd) {
					wonPrevRange.count += 1;
					wonPrevRange.valueCents += cents;
				}
			}

			if (closedAt < rateStart) continue;
			if (won) {
				wins += 1;
				wonCents += cents;
				cycleDays += (closedAt.getTime() - deal.createdAt.getTime()) / DAY_MS;
			} else if (stage === DealStage.CLOSED_LOST) {
				losses += 1;
			}
		}

		const decided = wins + losses;

		return {
			scope: input.scope,
			range: {
				preset: input.range,
				from: range.start.toISOString(),
				to: range.end.toISOString(),
			},
			pipeline: {
				stages,
				totalCents: stages.reduce((total, s) => total + s.valueCents, 0),
				totalDeals: stages.reduce((total, s) => total + s.count, 0),
			},
			wonInRange,
			wonPrevRange,
			performance: {
				windowDays: RATE_WINDOW_DAYS,
				wins,
				losses,
				winRate: decided === 0 ? null : wins / decided,
				avgDealCents: wins === 0 ? null : Math.round(wonCents / wins),
				avgCycleDays: wins === 0 ? null : Math.round(cycleDays / wins),
			},
			trend,
			closingInRangeTotal: {
				count: closingInRangeTotals._count._all,
				valueCents: toCents(closingInRangeTotals._sum.amount) ?? 0,
			},
			biggestOpen: biggestOpen.map(
				({ amount, expectedCloseDate, stageChangedAt, ...deal }) => ({
					...deal,
					amountCents: toCents(amount),
					expectedCloseDate: expectedCloseDate?.toISOString() ?? null,
					stageChangedAt: stageChangedAt.toISOString(),
				}),
			),
			overdueTasks: overdueTasks.map(({ dueAt, ...task }) => ({
				...task,
				dueAt: dueAt?.toISOString() ?? null,
			})),
			recentActivity: recentActivity.map(({ createdAt, meta, ...entry }) => ({
				...entry,
				createdAt: createdAt.toISOString(),
				meta: meta as Record<string, unknown> | null,
			})),
		};
	}
}
