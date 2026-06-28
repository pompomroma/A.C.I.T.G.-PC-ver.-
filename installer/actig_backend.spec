# PyInstaller spec — freezes the ACTIG agent core into a self-contained `actig-core`
# directory bundle that the Electron app launches as a child process. Hidden imports cover
# the lazily-loaded optional stacks so a packaged build can use voice + Windows control.

# -*- mode: python ; coding: utf-8 -*-
import os
import sys

block_cipher = None

# SPECPATH is injected by PyInstaller = the directory containing this spec (installer/).
# Resolve the entry shim and the backend source dir absolutely so the build works no matter
# what directory PyInstaller is invoked from.
ENTRY = os.path.join(SPECPATH, "actig_core_entry.py")
BACKEND = os.path.abspath(os.path.join(SPECPATH, "..", "backend"))

hidden = [
    "actig.server",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan.on",
    "websockets",
    "websockets.legacy",
    "websockets.legacy.server",
    "anyio",
    "anthropic",
    "ollama",
    "langdetect",
    # frozen SQLAlchemy commonly misses these → "no such module sqlite"/comparator errors
    "sqlalchemy.dialects.sqlite",
    "sqlalchemy.sql.default_comparator",
]
if sys.platform == "win32":
    hidden += ["win32com", "win32com.client", "uiautomation", "pywinauto"]

datas = []
binaries = []

# When building the offline-voice variant (ACTIG_WITH_VOICE=1), pull in the voice packages'
# code, native binaries AND data files (model assets, espeak data, onnx runtimes) so the
# frozen exe runs the on-device STT/TTS/wake-word pipeline without any pip install.
if os.environ.get("ACTIG_WITH_VOICE") == "1":
    from PyInstaller.utils.hooks import collect_all

    for pkg in (
        "faster_whisper",
        "ctranslate2",
        "onnxruntime",
        "piper",
        "piper_phonemize",
        "openwakeword",
        "webrtcvad",
        "sounddevice",
        "numpy",
    ):
        try:
            d, b, h = collect_all(pkg)
            datas += d
            binaries += b
            hidden += h
        except Exception as exc:  # a missing optional sub-package shouldn't break the freeze
            print(f"[spec] collect_all({pkg}) skipped: {exc}")

a = Analysis(
    [ENTRY],
    pathex=[BACKEND],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib"],
    cipher=block_cipher,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="actig-core",
    console=False,
    disable_windowed_traceback=False,
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, name="actig-core")
