import pytest

from actig.agent.tools import ToolRegistry


@pytest.mark.asyncio
async def test_read_tool_runs_without_confirmation():
    reg = ToolRegistry()
    seen = []

    async def confirm(tool, desc, risk):
        seen.append(tool)
        return True

    res = await reg.dispatch("system_info", {}, confirm=confirm)
    assert res.ok is True
    assert seen == []  # read tools never prompt


@pytest.mark.asyncio
async def test_sensitive_tool_requires_confirmation(tmp_path):
    reg = ToolRegistry()
    target = tmp_path / "f.txt"
    target.write_text("x")
    prompts = []

    async def deny(tool, desc, risk):
        prompts.append((tool, risk))
        return False

    res = await reg.dispatch("delete_file", {"path": str(target)}, confirm=deny)
    assert res.ok is False
    assert prompts == [("delete_file", "sensitive")]
    assert target.exists()  # not deleted because user declined


@pytest.mark.asyncio
async def test_sensitive_tool_runs_when_approved(tmp_path):
    reg = ToolRegistry()
    target = tmp_path / "f.txt"
    target.write_text("x")

    async def approve(tool, desc, risk):
        return True

    res = await reg.dispatch("delete_file", {"path": str(target)}, confirm=approve)
    assert res.ok is True
    assert not target.exists()


@pytest.mark.asyncio
async def test_default_denied_tool_is_blocked():
    reg = ToolRegistry()

    async def approve(tool, desc, risk):
        return True

    res = await reg.dispatch("shell_raw", {"command": "echo hi"}, confirm=approve)
    assert res.ok is False
    assert "disabled by default" in res.summary
