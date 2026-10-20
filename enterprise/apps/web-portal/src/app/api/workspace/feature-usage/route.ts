import { NextResponse } from "next/server";
import { METERED_FEATURES } from "@agenticx/config";

import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../lib/session";
import { readFeatureUsageState } from "../../../../lib/feature-usage/gate";
import { featureUsageSubject } from "../../../../lib/feature-usage/subject";

/**
 * Remaining search and deep-research allowance for the signed-in member.
 * Identity comes only from the session.
 */
export async function GET(request: Request) {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) return passwordChangeRequiredResponse();
  if (!session) {
    return NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 });
  }
  void request;

  try {
    const subject = await featureUsageSubject(session);
    const states = await Promise.all(
      METERED_FEATURES.map((feature) => readFeatureUsageState(feature, subject)),
    );
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        features: Object.fromEntries(states.map((state) => [state.feature, state])),
      },
    });
  } catch {
    return NextResponse.json(
      { code: "50001", message: "用量信息暂时不可用" },
      { status: 500 },
    );
  }
}
