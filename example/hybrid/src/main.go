package main

import "./sim"

// ── Simulation state (JS side) ────────────────────────────────

const (
	canvasW float32 = 640
	canvasH float32 = 480
)

var (
	canvas  any
	ctx     any
	paused  = false
	target  = 2048
	lastNow = 0.0
	frames  = 0
	fpsTime = 0.0
	fps     = 0
	mouseX  = canvasW / 2
	mouseY  = canvasH / 2
	refs    = map[string]any{}
)

func render() {
	gom.Mount("#controls", Controls(target, paused, sim.Count()), refs)
}

// ── Frame loop ────────────────────────────────────────────────

func frame(now float64) {
	dt := float32(0)
	if lastNow > 0 {
		dt = float32((now - lastNow) / 1000.0)
		if dt > 0.05 {
			dt = 0.05
		}
	}
	lastNow = now

	if !paused {
		// Physics runs in wasm; sim.Positions is a Float32Array view over
		// the module's linear memory, so nothing is copied per frame.
		sim.Step(dt, mouseX, mouseY, canvasW, canvasH)
	}

	ctx.fillStyle = "rgba(13, 15, 18, 0.35)"
	ctx.fillRect(0, 0, canvasW, canvasH)
	ctx.fillStyle = "#00add8"
	n := sim.Count()
	pos := sim.Positions
	for i := 0; i < n; i++ {
		ctx.fillRect(pos[i*2], pos[i*2+1], 2, 2)
	}

	frames++
	if now-fpsTime >= 1000 {
		fps = frames
		frames = 0
		fpsTime = now
		if refs["fps"] != nil {
			refs["fps"].textContent = fmt.Sprintf("%d fps", fps)
		}
	}
	requestAnimationFrame(frame)
}

// ── Events ────────────────────────────────────────────────────

func setupEvents() {
	canvas.addEventListener("mousemove", func(e any) {
		rect := canvas.getBoundingClientRect()
		mouseX = float32(e.clientX-rect.left) * canvasW / float32(rect.width)
		mouseY = float32(e.clientY-rect.top) * canvasH / float32(rect.height)
	})

	controls := document.querySelector("#controls")
	controls.addEventListener("click", func(e any) {
		btn := e.target.closest("[data-action]")
		if btn == nil {
			return
		}
		switch btn.getAttribute("data-action") {
		case "count":
			target = int(btn.getAttribute("data-count"))
			sim.Reset(target, canvasW, canvasH)
			render()
		case "pause":
			paused = !paused
			render()
		case "reset":
			sim.Reset(target, canvasW, canvasH)
			render()
		}
	})
}

// ── Entry point ───────────────────────────────────────────────

func main() {
	canvas = document.getElementById("sim")
	ctx = canvas.getContext("2d")

	sim.Reset(target, canvasW, canvasH)
	render()
	setupEvents()
	requestAnimationFrame(frame)
}
