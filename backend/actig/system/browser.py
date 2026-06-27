"""Browser + music tools (requirements 18, 19: open URLs, play music via web).

``open_url`` uses the OS default browser. ``play_music`` builds a search/watch URL for the
requested service and opens it; on a full install the Playwright path can additionally
auto-click play, but the default-browser path works everywhere with no extra deps.
"""

from __future__ import annotations

import urllib.parse
import webbrowser

from .base import ToolResult

_MUSIC_SERVICES = {
    "youtube": "https://www.youtube.com/results?search_query={q}",
    "ytmusic": "https://music.youtube.com/search?q={q}",
    "spotify": "https://open.spotify.com/search/{q}",
    "soundcloud": "https://soundcloud.com/search?q={q}",
}


def open_url(url: str) -> ToolResult:  # risk: safe_write
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        webbrowser.open(url)
    except Exception as exc:
        return ToolResult.fail(f"Could not open browser: {exc}")
    return ToolResult(ok=True, summary=f"Opened {url}.", data={"url": url})


def play_music(query: str, service: str = "youtube") -> ToolResult:  # risk: safe_write
    service = service.lower()
    template = _MUSIC_SERVICES.get(service, _MUSIC_SERVICES["youtube"])
    url = template.format(q=urllib.parse.quote(query))
    try:
        webbrowser.open(url)
    except Exception as exc:
        return ToolResult.fail(f"Could not start playback: {exc}")
    return ToolResult(
        ok=True,
        summary=f"Playing '{query}' on {service}.",
        data={"url": url, "service": service, "query": query},
    )
