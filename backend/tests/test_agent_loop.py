import pytest

from actig.agent import AgentLoop
from actig.agent.tools import ToolRegistry
from actig.brain import HybridBrain
from actig.history import HistoryStore
from actig.protocol import UserInputPayload
from tests.fakes import FakeProvider, final_result, tool_call_result


@pytest.mark.asyncio
async def test_plain_turn_returns_natural_reply():
    cloud = FakeProvider("claude", script=[final_result("Hey, how can I help?", "claude")])
    brain = HybridBrain(local=FakeProvider("ollama", available=False), cloud=cloud)
    loop = AgentLoop(brain=brain)
    out = await loop.run(UserInputPayload(text="hello", source="text"))
    assert out.text == "Hey, how can I help?"
    assert out.brain == "claude"


@pytest.mark.asyncio
async def test_tool_turn_records_process_and_confirms(tmp_path):
    f = tmp_path / "victim.txt"
    f.write_text("data")
    history = HistoryStore()
    registry = ToolRegistry(history=history)
    # First the brain asks to delete a file (sensitive), then gives a final reply.
    cloud = FakeProvider(
        "claude",
        script=[
            tool_call_result("delete_file", {"path": str(f)}, "c1"),
            final_result("Done — I removed it.", "claude"),
        ],
    )
    brain = HybridBrain(local=FakeProvider("ollama", available=False), cloud=cloud)
    loop = AgentLoop(brain=brain, registry=registry, history=history)

    emitted = []

    async def emit(t, p):
        emitted.append((t, p))

    confirmed = {"asked": False}

    async def confirm(tool, desc, risk):
        confirmed["asked"] = True
        assert tool == "delete_file" and risk == "sensitive"
        return True

    out = await loop.run(
        UserInputPayload(text="delete victim.txt", source="text"),
        emit=emit,
        confirm=confirm,
    )
    assert confirmed["asked"] is True
    assert not f.exists()  # deleted after approval
    assert out.process and out.process[0].status == "succeeded"
    # tool_call + tool_result were streamed to the UI
    types = [t for t, _ in emitted]
    assert "tool_call" in types and "tool_result" in types


@pytest.mark.asyncio
async def test_language_roundtrips_to_reply():
    cloud = FakeProvider("claude", script=[final_result("Bonjour !", "claude")])
    brain = HybridBrain(local=FakeProvider("ollama", available=False), cloud=cloud)
    loop = AgentLoop(brain=brain)
    out = await loop.run(UserInputPayload(text="Bonjour, comment ça va?", source="text"))
    assert out.lang == "fr"
