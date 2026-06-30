package main

import (
	"context"
	"fmt"
)

// App holds the Wails runtime context and exposes methods to the frontend (bound in main.go).
// Frontend JS calls these as window.go.main.App.<Method>(...).
type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

// startup stores the runtime context once the window is ready.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Greet is a tiny round-trip so the frontend can prove the Go backend is wired up.
func (a *App) Greet(name string) string {
	if name == "" {
		name = "sir"
	}
	return fmt.Sprintf("ACTIG at your service, %s.", name)
}
