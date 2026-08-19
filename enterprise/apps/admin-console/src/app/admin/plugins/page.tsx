import { redirect } from "next/navigation";

/** Wasm 插件已并入「工具与能力」。旧地址保留兜底，书签和外链不断。 */
export default function AdminPluginsPage() {
  redirect("/admin/capabilities?tab=plugins");
}
