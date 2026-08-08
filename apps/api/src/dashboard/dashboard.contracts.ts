import { z } from "zod";

const DASHBOARD_SCOPES = ["me", "everyone"] as const;

export const DASHBOARD_RANGES = [
	"today",
	"this_week",
	"last_week",
	"this_month",
	"last_month",
	"last_3_months",
	"this_year",
	"custom",
] as const;

export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const dashboardSummaryInput = z.object({
	scope: z.enum(DASHBOARD_SCOPES).default("me"),
	range: z.enum(DASHBOARD_RANGES).default("this_month"),
	// Day strings (YYYY-MM-DD), only read when range is "custom"; the range is
	// inclusive of both days. Invalid or missing bounds fall back to this_month.
	from: z.string().optional(),
	to: z.string().optional(),
});

export type DashboardSummaryInput = z.infer<typeof dashboardSummaryInput>;
