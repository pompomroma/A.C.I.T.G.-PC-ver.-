import pytest

from actig.brain import BrainMessage, HybridBrain
from tests.fakes import FakeProvider, final_result


@pytest.mark.asyncio
async def test_hard_turn_goes_to_cloud():
    local = FakeProvider("ollama")
    cloud = FakeProvider("claude")
    brain = HybridBrain(local=local, cloud=cloud)
    msgs = [BrainMessage("user", "Please debug and refactor this step by step")]
    assert await brain.which(msgs) == "claude"
    res = await brain.complete(msgs)
    assert res.provider == "claude"
    assert local.calls == 0


@pytest.mark.asyncio
async def test_simple_turn_uses_local_when_confident():
    local = FakeProvider("ollama", confidence=0.9)
    cloud = FakeProvider("claude")
    brain = HybridBrain(local=local, cloud=cloud, threshold=0.62)
    res = await brain.complete([BrainMessage("user", "hi")])
    assert res.provider == "ollama"
    assert cloud.calls == 0


@pytest.mark.asyncio
async def test_low_confidence_escalates_to_cloud():
    local = FakeProvider("ollama", script=[final_result("meh", "ollama")], confidence=0.2)
    local._script[0].confidence = 0.2
    cloud = FakeProvider("claude", script=[final_result("better", "claude")])
    brain = HybridBrain(local=local, cloud=cloud, threshold=0.62)
    res = await brain.complete([BrainMessage("user", "hi")])
    assert res.provider == "claude"


@pytest.mark.asyncio
async def test_all_down_returns_graceful_message():
    local = FakeProvider("ollama", available=False)
    cloud = FakeProvider("claude", available=False)
    brain = HybridBrain(local=local, cloud=cloud)
    res = await brain.complete([BrainMessage("user", "hi")])
    assert res.finish_reason == "error"
    assert "can't reach" in res.text.lower()
