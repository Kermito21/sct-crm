import type { Metadata } from "next";
import PipelinePanel from "@/components/onboarding/PipelinePanel";

export const metadata: Metadata = { title: "Pipeline" };

export default function PipelinePage() {
	return <PipelinePanel />;
}
