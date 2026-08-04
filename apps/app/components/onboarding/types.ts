
export interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  productTier: string;
  tiers: string[];
  tvUsername: string | null;
  automationPlatform: string | null;
  strategySelection: string | null;
  forwardingUrl: string | null;
  intakeCompleted: boolean;
  intakeCompletedAt: string | null;
  riskDisclaimerAccepted: boolean;
  tvWhitelisted: boolean;
  onboardingCallCompleted: boolean;
  onboardingStatus: string;
  phone: string | null;
  paymentStatus: string | null;
  copierMode: string | null;
  agreementAccepted: boolean;
  agreementAcceptedAt: string | null;
  closerName: string | null;
  isVip: boolean;
  source: string;
  agreementSignedName: string | null;
  agreementVersion: string | null;
  fanbasisCustomerId: string | null;
  fanbasisPaymentId: string | null;
  fanbasisProductId: string | null;
  riskPerTradePct: number | null;
  maxDailyLoss: number | null;
  shippingAddressLine1: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZip: string | null;
  shippingCountry: string | null;
  purchasedAt: string | null;
  packageForm: Record<string, unknown> | null;
  createdAt: string;
  _count: { signals: number; milestones: number; journals: number; chatMessages: number; adminNotes?: number };
}

export type OnboardingStatus = "invited" | "password_set" | "intake_completed" | "active";

export interface InviteResult {
  success: boolean;
  emailSent: boolean;
  inviteUrl?: string;
  message?: string;
}
