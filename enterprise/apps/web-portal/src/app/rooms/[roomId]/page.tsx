import { redirect } from "next/navigation";
import { RoomChatView } from "../../../components/rooms/RoomChatView";
import { getWorkspaceSessionFromCookies } from "../../../lib/session";

export default async function RoomPage(segmentData: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await segmentData.params;
  const result = await getWorkspaceSessionFromCookies();
  if (result.status === "unauthenticated") redirect("/auth");
  if (result.status === "password_change_required") redirect("/auth/change-password");

  return <RoomChatView roomId={roomId} currentUserId={result.session.userId} />;
}
