import { redirect } from "next/navigation";
import { RoomListView } from "../../components/rooms/RoomListView";
import { getWorkspaceSessionFromCookies } from "../../lib/session";

export default async function RoomsPage() {
  const result = await getWorkspaceSessionFromCookies();
  if (result.status === "unauthenticated") redirect("/auth");
  if (result.status === "password_change_required") redirect("/auth/change-password");

  return <RoomListView currentUserEmail={result.session.email} />;
}
