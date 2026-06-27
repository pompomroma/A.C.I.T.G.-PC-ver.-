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
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "anthropic",
    "ollama",
    "langdetect",
]
if sys.platform == "win32":
    hidden += ["win32com", "win32com.client", "uiautomation", "pywinauto"]

a = Analysis(
    [ENTRY],
    pathex=[BACKEND],
    binaries=[],
    datas=[],
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
