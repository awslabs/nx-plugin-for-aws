from bedrock_agentcore.runtime import BedrockAgentCoreApp

from .agent import get_agent

app = BedrockAgentCoreApp()


@app.entrypoint
async def invoke(payload, context):
    """Handler for agent invocation"""
    prompt = payload.get(
        "prompt", "No prompt found in input, please guide the user "
        "to create a json payload with prompt key"
    )

    with get_agent(session_id=context.session_id) as agent:
        stream = agent.stream_async(prompt)
        async for event in stream:
            print(event)
            yield (event)


if __name__ == "__main__":
    app.run()
