import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { getSessionFromCookies } from "../../../lib/session";
import { getChatShareSnapshot } from "../../../lib/chat-history";
import { SharedConversationView } from "../../../components/share/SharedConversationView";

type Params = Promise<{ token: string }>;

export default async function SharedConversationPage({ params }: { params: Params }) {
  const { token } = await params;
  if (!token || token.length > 64) notFound();
  const session = await getSessionFromCookies();
  if (!session) {
    redirect(`/auth?returnTo=${encodeURIComponent(`/share/${token}`)}`);
  }
  if (session.mustChangePassword) redirect("/auth/change-password");

  try {
    const snapshot = await getChatShareSnapshot(token, session.tenantId);
    if (!snapshot || snapshot.messages.length === 0) notFound();
    return <SharedConversationView snapshot={snapshot} />;
  } catch {
    notFound();
  }
}
