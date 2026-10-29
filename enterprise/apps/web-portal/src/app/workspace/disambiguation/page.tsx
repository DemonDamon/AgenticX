import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DisambiguationChoicePanel } from "../../../components/disambiguation/DisambiguationChoicePanel";
import { getWorkspaceSessionFromCookies } from "../../../lib/session";

/**
 * Mount point for R2 portal choice-panel.
 * Auth same as /workspace; store = runtime disambiguation sessions.
 */
export default async function WorkspaceDisambiguationPage() {
  const result = await getWorkspaceSessionFromCookies();
  if (result.status === "unauthenticated") {
    redirect("/auth");
  }
  if (result.status === "password_change_required") {
    redirect("/auth/change-password");
  }
  const t = await getTranslations("disambiguation");

  return (
    <main className="mx-auto max-w-[1440px] space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link
          href="/workspace"
          className="text-sm text-primary underline-offset-4 hover:underline"
          data-testid="portal-disambiguation-back"
        >
          {t("backToWorkspace")}
        </Link>
      </div>
      <DisambiguationChoicePanel />
    </main>
  );
}
