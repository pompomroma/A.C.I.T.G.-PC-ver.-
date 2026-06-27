"""Shared test fixtures. Each test gets an isolated temp data dir + fresh DB.

We avoid module reloads: ``init_db()`` rebinds the engine/session globals in
``actig.history.db`` and ``session_scope`` reads those globals at call time, so simply
clearing the settings cache and re-initialising is enough for isolation.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def temp_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTIG_DATA_DIR", str(tmp_path / "actig"))
    from actig.config import settings as settings_mod
    from actig.history import db as db_mod

    settings_mod.get_settings.cache_clear()
    db_mod.init_db()  # rebinds engine to the new per-test sqlite file
    yield
    settings_mod.get_settings.cache_clear()
