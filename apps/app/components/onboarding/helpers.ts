import { type OnboardingStatus } from "./types";

export const STAGE_LABELS: Record<OnboardingStatus, string> = {
  invited: "Invited",
  password_set: "Password Set",
  intake_completed: "Intake Done",
  active: "Active",
};

export const TIER_COLORS: Record<string, string> = {
  inner_circle: "bg-[#535461]/20 text-sct-body border-[#535461]/30",
  flex: "bg-sct-cta/20 text-sct-cta border-[#4d68eb]/30",
  unlimited: "bg-sct-heading/20 text-sct-heading border-sct-heading/30",
  dynamis: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  praxis: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  infinitus: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
};
