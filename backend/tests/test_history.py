from actig.history import CheckpointManager, HistoryStore


def test_turns_persist_with_language_and_payload():
    h = HistoryStore()
    h.add_turn("user", "Hola", lang="es")
    h.add_turn("assistant", "Hola, ¿qué tal?", lang="es", payload={"eta": "a moment"})
    turns = h.recent_turns()
    assert [t["role"] for t in turns] == ["user", "assistant"]
    assert turns[0]["lang"] == "es"
    assert turns[1]["payload"]["eta"] == "a moment"


def test_artifact_bytes_stored_and_hashed():
    h = HistoryStore()
    aid = h.store_artifact_bytes("out.txt", b"hello", kind="file")
    assert isinstance(aid, int)


def test_task_process_and_audit():
    h = HistoryStore()
    tid = h.start_task("do a thing", eta="under a minute")
    h.log_step(tid, "step one", "running")
    h.log_step(tid, "step one", "succeeded", "done")
    h.finish_task(tid, "succeeded", "all good")
    h.audit("delete_file", "sensitive", "approved", "deleted x")
    cid = h.log_command("open_app", {"name": "notepad"}, True, "opened", task_id=tid)
    assert isinstance(cid, int)


def test_checkpoint_latest_and_resume():
    cp = CheckpointManager()
    steps = [{"step": "a", "status": "succeeded"}, {"step": "b", "status": "running"}]
    cp.save("workflow", steps, cursor=1, task_id=1)
    latest = cp.latest(task_id=1)
    assert latest is not None
    assert latest["cursor"] == 1
    assert 0.0 < latest["progress"] < 1.0
    # unfinished workflow should resume
    assert cp.resume_latest() is not None
    # once all steps finished, nothing to resume
    cp.save("workflow", [{"step": "a", "status": "succeeded"}], cursor=0, task_id=1)
    assert cp.resume_latest() is None
