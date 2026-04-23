import { redirect } from "next/navigation";
import { requireAdminPageSession } from "../lib/admin-page-guard";

export default async function Page() {
  await requireAdminPageSession();
  redirect("/dashboard");
}
