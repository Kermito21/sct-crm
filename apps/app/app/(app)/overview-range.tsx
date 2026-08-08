"use client";

import { DatePicker } from "@crm/ui/components/date-picker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { useQueryState } from "nuqs";
import {
	OVERVIEW_RANGES,
	type OverviewRange,
	overviewParsers,
	RANGE_LABELS,
} from "./overview-search-params";

function isRange(value: string): value is OverviewRange {
	return (OVERVIEW_RANGES as readonly string[]).includes(value);
}

export function OverviewRangePicker() {
	const [range, setRange] = useQueryState("range", overviewParsers.range);
	const [from, setFrom] = useQueryState("from", overviewParsers.from);
	const [to, setTo] = useQueryState("to", overviewParsers.to);

	return (
		<div className="flex items-center gap-2">
			{range === "custom" ? (
				<>
					<div className="w-32">
						<DatePicker
							value={from || null}
							onChange={(next) => void setFrom(next)}
							placeholder="From"
						/>
					</div>
					<div className="w-32">
						<DatePicker
							value={to || null}
							onChange={(next) => void setTo(next)}
							placeholder="To"
						/>
					</div>
				</>
			) : null}
			<Select
				value={range}
				onValueChange={(next) => {
					if (isRange(next)) void setRange(next);
				}}
			>
				<SelectTrigger size="sm" aria-label="Date range">
					<SelectValue />
				</SelectTrigger>
				<SelectContent align="end">
					{OVERVIEW_RANGES.map((value) => (
						<SelectItem key={value} value={value}>
							{RANGE_LABELS[value]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
