"""PyInstaller entry shim — boots the ACTIG agent core server."""

from actig.server import main

if __name__ == "__main__":
    main()
