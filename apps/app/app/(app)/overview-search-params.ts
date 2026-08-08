import { createLoader, parseAsString, parseAsStringLiteral } from "nuqs/server";

export const OVERVIEW_SCOPES = ["me", "everyone"] as const;

export type OverviewScope = (typeof OVERVIEW_SCOPES)[number];

export const OVERVIEW_RANGES = [
	"today",
	"this_week",
	"last_week",
	"this_month",
	"last_month",
	"last_3_months",
	"this_year",
	"custom",
] as const;

export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

export const RANGE_LABELS: Record<OverviewRange, string> = {
	today: "Today",
	this_week: "This week",
	last_week: "Last week",
	this_month: "This month",
	last_month: "Last month",
	last_3_months: "Last 3 months",
	this_year: "This year",
	custom: "Custom",
};

export const overviewParsers = {
	scope: parseAsStringLiteral(OVERVIEW_SCOPES).withDefault("me"),
	range: parseAsStringLiteral(OVERVIEW_RANGES).withDefault("this_month"),
	from: parseAsString.withDefault(""),
	to: parseAsString.withDefault(""),
};

export const loadOverviewSearchParams = createLoader(overviewParsers);
