# PyInstaller spec — freezes the ACTIG agent core into a self-contained `actig-core`
# directory bundle that the Electron app launches as a child process. Hidden imports cover
# the lazily-loaded optional stacks so a packaged build can use voice + Windows control.

# -*- mode: python ; coding: utf-8 -*-
import sys

block_cipher = None

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
    ["actig_core_entry.py"],
    pathex=["backend"],
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
