package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// The embedded frontend. `wails build` serves these assets to the WebView2 window.
//
//go:embed all:frontend/dist
var assets embed.FS

// ACTIG (Wails edition) — phase-1 foundation.
//
// This is a minimal but real Wails v2 Windows app that builds to a single ACTIG.exe via the
// `Wails Build Windows` workflow. It proves the Go + WebView2 pipeline as an alternative to the
// Electron build (smaller binary, typically fewer antivirus false-positives). The full ACTIG
// feature set (transparent overlay, 3D space, live wallpaper, voice, Nemotron agent) is ported
// in incrementally on top of this foundation.
func main() {
	app := NewApp()
	if err := wails.Run(&options.App{
		Title:     "ACTIG",
		Width:     1100,
		Height:    760,
		MinWidth:  640,
		MinHeight: 480,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 3, G: 8, B: 14, A: 1},
		OnStartup:        app.startup,
		Bind:             []interface{}{app},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
	}); err != nil {
		println("error:", err.Error())
	}
}
