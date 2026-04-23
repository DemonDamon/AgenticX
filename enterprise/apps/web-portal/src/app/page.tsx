import { redirect } from "next/navigation";
import { getSessionFromCookies } from "../lib/session";

export default async function Page() {
  const session = await getSessionFromCookies();
  redirect(session ? "/workspace" : "/auth");
}
