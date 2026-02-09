#!/usr/bin/env python3
'''AgentKit Wrapper for hi-agent with streaming support.

Based on the official basic_stream template from AgentKit.

Author: Damon Li
'''
import json
import logging

from google.adk.agents import RunConfig
from google.adk.agents.run_config import StreamingMode
from google.genai.types import Content, Part
from veadk import Agent, Runner

from agentkit.apps import AgentkitSimpleApp
from veadk.prompts.agent_default_prompt import DEFAULT_DESCRIPTION, DEFAULT_INSTRUCTION

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

app = AgentkitSimpleApp()

app_name = "hi-agent"

agent_name = "Agent"
description = DEFAULT_DESCRIPTION
system_prompt = DEFAULT_INSTRUCTION

tools = []

agent = Agent(
    name=agent_name,
    description=description,
    instruction=system_prompt,
    tools=tools,
)
agent.model._additional_args["stream_options"] = {"include_usage": True}
runner = Runner(agent=agent, app_name=app_name)


@app.entrypoint
async def run(payload: dict, headers: dict):
    """Entrypoint with SSE streaming support."""
    prompt = payload.get("prompt", "")
    user_id = headers.get("user_id", payload.get("user_id", "default_user"))
    session_id = headers.get("session_id", payload.get("session_id", "default_session"))
    stream = payload.get("stream", False)

    logger.info(
        f"Running agent with prompt: {prompt}, "
        f"user_id: {user_id}, session_id: {session_id}, "
        f"stream: {stream}"
    )

    if stream:
        # Streaming mode: SSE
        session_service = runner.short_term_memory.session_service

        session = await session_service.get_session(
            app_name=app_name, user_id=user_id, session_id=session_id
        )
        if not session:
            await session_service.create_session(
                app_name=app_name, user_id=user_id, session_id=session_id
            )

        new_message = Content(role="user", parts=[Part(text=prompt)])
        try:
            async for event in runner.run_async(
                user_id=user_id,
                session_id=session_id,
                new_message=new_message,
                run_config=RunConfig(streaming_mode=StreamingMode.SSE),
            ):
                sse_event = event.model_dump_json(exclude_none=True, by_alias=True)
                logger.debug("SSE event: %s", sse_event)
                yield sse_event
        except Exception as e:
            logger.exception("Error in streaming: %s", e)
            yield json.dumps({"error": str(e)})
    else:
        # Normal mode: full response
        response = await runner.run(
            messages=prompt, user_id=user_id, session_id=session_id
        )
        logger.info(f"Response: {response}")
        yield response


@app.ping
def ping() -> str:
    """Health check endpoint."""
    return "pong!"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
