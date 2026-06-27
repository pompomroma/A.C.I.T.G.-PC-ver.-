from actig.config.capabilities import default_registry


def test_read_runs_without_confirmation():
    reg = default_registry()
    assert reg.risk_of("system_info") == "read"
    assert reg.needs_confirmation("system_info") is False


def test_sensitive_and_system_need_confirmation():
    reg = default_registry()
    assert reg.needs_confirmation("delete_file") is True
    assert reg.needs_confirmation("write_settings") is True


def test_unknown_tool_is_treated_cautiously():
    reg = default_registry()
    assert reg.risk_of("definitely_not_a_tool") == "sensitive"
    assert reg.needs_confirmation("definitely_not_a_tool") is True


def test_default_deny_blocks_until_enabled():
    reg = default_registry()
    assert reg.is_blocked("shell_raw") is True
    reg.enabled_dangerous.add("shell_raw")
    assert reg.is_blocked("shell_raw") is False


def test_approve_always_skips_confirmation():
    reg = default_registry()
    assert reg.needs_confirmation("delete_file") is True
    reg.approve_always("delete_file")
    assert reg.needs_confirmation("delete_file") is False
