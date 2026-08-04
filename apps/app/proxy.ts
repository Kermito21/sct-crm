import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import {
	ONBOARDING_PATH,
	RESEARCH_PATH,
	readOnboardingGate,
} from "@/lib/onboarding";

const SIGN_IN_PATH = "/sign-in";

const GATE_COOKIE = "crm-gate";

const UNGATED = [SIGN_IN_PATH, "/grant-access", "/eve"];

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (
		getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX }) === null
	) {
		return pathname === SIGN_IN_PATH
			? NextResponse.next()
			: NextResponse.redirect(new URL(SIGN_IN_PATH, request.nextUrl));
	}

	if (isUngated(pathname)) return NextResponse.next();

	// Onboarding can never un-complete, so once a browser has seen it settled
	// we remember that in a cookie and skip the per-navigation API round trip
	// the gate check costs (edge → API → DB on every click).
	if (request.cookies.get(GATE_COOKIE)?.value === "settled") {
		return isSetup(pathname)
			? NextResponse.redirect(new URL("/", request.nextUrl))
			: NextResponse.next();
	}

	const onboarding = await readOnboardingGate(request);

	if (onboarding === "required") return sendTo(ONBOARDING_PATH, request);
	// The Context key is optional for this install: never gate sign-in on it.
	// It can be added any time in Settings → General; until then the agent
	// simply runs without brand data. (Upstream hard-gates here, which locks
	// every user out of the dashboard when no key exists.)

	const settled = onboarding === "settled";

	const response =
		settled && isSetup(pathname)
			? NextResponse.redirect(new URL("/", request.nextUrl))
			: NextResponse.next();

	if (settled) {
		response.cookies.set(GATE_COOKIE, "settled", {
			httpOnly: true,
			secure: true,
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 60 * 24 * 30,
		});
	}

	return response;
}

function isUngated(pathname: string): boolean {
	return UNGATED.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

function isSetup(pathname: string): boolean {
	return pathname === ONBOARDING_PATH || pathname === RESEARCH_PATH;
}

function sendTo(path: string, request: NextRequest): NextResponse {
	return request.nextUrl.pathname === path
		? NextResponse.next()
		: NextResponse.redirect(new URL(path, request.nextUrl));
}

export const config = {
	matcher: [
		"/((?!api|_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest)$).*)",
	],
};
