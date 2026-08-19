import { redirect } from "next/navigation";

/** 已并入「用量与成本」。旧地址保留兜底。 */
export default function MeteringSplitPage() {
  redirect("/metering?tab=split");
}
