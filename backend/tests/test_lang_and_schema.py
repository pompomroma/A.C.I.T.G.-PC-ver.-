from actig.agent.schema import AssistantTurnBuilder, parse_meta
from actig.lang import LanguageState, language_name


def test_language_state_updates_and_resolves():
    st = LanguageState()
    assert st.resolve("hello there", stt_lang=None) in ("en", "und")
    # STT-provided language wins
    assert st.resolve("anything", stt_lang="ja") == "ja"
    assert st.current == "ja"


def test_language_name_known_and_fallback():
    assert language_name("ja") == "Japanese"
    assert language_name("xx") == "xx"


def test_parse_meta_extracts_block_and_cleans_text():
    raw = (
        "Sure, opening that now.\n"
        "```actig-meta\n"
        '{"eta": "about 10 seconds", "options": [{"label": "Cancel", "command": "stop"}]}\n'
        "```"
    )
    clean, meta = parse_meta(raw)
    assert clean == "Sure, opening that now."
    assert meta["eta"] == "about 10 seconds"
    assert meta["options"][0]["label"] == "Cancel"


def test_builder_folds_meta_and_process_steps():
    b = AssistantTurnBuilder(lang="en", brain="claude")
    b.add_step("open_app(notepad)", "succeeded", "opened")
    b.set_eta("under a minute")
    payload = b.build(
        'Done.\n```actig-meta\n{"recommendations": [{"label": "Pin it"}]}\n```'
    )
    assert payload.text == "Done."
    assert payload.lang == "en"
    assert payload.process[0].status == "succeeded"
    assert payload.eta == "under a minute"
    assert payload.recommendations[0].label == "Pin it"
    assert payload.recommendations[0].kind == "recommendation"
