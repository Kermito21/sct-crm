import type { Metadata } from "next";
import OnboardingFlowsPanel from "@/components/onboarding/OnboardingFlowsPanel";

export const metadata: Metadata = { title: "Onboarding" };

export default function OnboardingFlowsPage() {
	return (
		<main className="min-w-0 flex-1 overflow-y-auto">
			<OnboardingFlowsPanel />
		</main>
	);
}
