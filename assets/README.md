# ACTIG assets

Large binary models are **not** committed (see `.gitignore`). The installer/first-run
downloads them into the per-user data dir; for local dev, place them here:

```
assets/
  models/
    wake_up_actig.onnx     # openWakeWord model for the phrase "wake up ACTIG" (req 6)
  voices/
    en_US.onnx  en_US.onnx.json   # Piper voice (English)  (req 2, 7)
    ja_JP.onnx  ja_JP.onnx.json   # Piper voice (Japanese) — add per language you need
    es_ES.onnx  es_ES.onnx.json
  icons/
    tray.png  app.ico
  hologram/                # optional UI textures
```

## Training the wake word ("wake up ACTIG")
The custom phrase is trained with openWakeWord's notebook (a few hundred synthetic samples
is enough). Output `wake_up_actig.onnx` into `assets/models/`. The detector references it by
name in `backend/actig/voice/wakeword.py`.

## Piper voices
Download from the Piper voices catalog. Map language → file in
`backend/actig/voice/tts.py` (`_voice_path`). English is the default fallback.
