import { NextResponse } from "next/server";
import { AgentValidationError, registerEmployeeAgent } from "@agenticx/iam-core";
import { resolveDesktopIdentity } from "../../../../../lib/desktop-auth";
import { readJsonObject, workerErrorResponse, workerUnauthorized, WorkerRequestError } from "../../../../../lib/worker-tasks/protocol";

export async function POST(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  try {
    const body = await readJsonObject(request);
    const localAvatarId = typeof body.local_avatar_id === "string" ? body.local_avatar_id.trim() : "";
    const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
    if (!localAvatarId || !displayName) throw new WorkerRequestError("分身名称和本机标识不能为空");
    const agent = await registerEmployeeAgent({
      tenantId: identity.tenantId,
      ownerUserId: identity.userId,
      localAvatarId,
      displayName,
      systemPrompt: typeof body.system_prompt === "string" ? body.system_prompt : "",
      model: typeof body.model === "string" ? body.model : "",
      description: typeof body.description === "string" ? body.description : null,
    });
    return NextResponse.json({
      id: agent.id,
      lifecycle: agent.lifecycle,
      origin: agent.origin,
    });
  } catch (error) {
    if (error instanceof AgentValidationError) {
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    }
    return workerErrorResponse(error);
  }
}
