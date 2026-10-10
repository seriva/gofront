//gofront:target wasm
package sim

import "gofront/shared"

// MaxParticles is the fixed capacity of the simulation. All buffers are
// allocated once at startup (gofront/shared forbids later allocation) and
// exposed to JavaScript as zero-copy TypedArray views over the wasm memory.
const MaxParticles = 4096

// Positions holds interleaved x,y pairs; JS reads it directly to draw.
var Positions = shared.NewFloat32(MaxParticles * 2)

// Velocities holds interleaved vx,vy pairs.
var Velocities = shared.NewFloat32(MaxParticles * 2)

var count int = 0
var seed uint32 = 0x9e3779b9

func rnd() float32 {
	// xorshift32 — deterministic so the demo looks the same on every load.
	seed ^= seed << 13
	seed ^= seed >> 17
	seed ^= seed << 5
	return float32(seed%10000) / 10000.0
}

// Reset re-seeds the first n particles inside a width×height box.
func Reset(n int, width float32, height float32) {
	if n < 0 {
		n = 0
	}
	if n > MaxParticles {
		n = MaxParticles
	}
	count = n
	for i := 0; i < n; i++ {
		Positions[i*2] = rnd() * width
		Positions[i*2+1] = rnd() * height
		Velocities[i*2] = (rnd() - 0.5) * 120.0
		Velocities[i*2+1] = (rnd() - 0.5) * 120.0
	}
}

// Count returns the number of live particles.
func Count() int { return count }

// Step advances the simulation by dt seconds: a soft attractor at
// (ax, ay), a little drag and elastic walls at the box edges.
func Step(dt float32, ax float32, ay float32, width float32, height float32) {
	for i := 0; i < count; i++ {
		px := Positions[i*2]
		py := Positions[i*2+1]
		vx := Velocities[i*2]
		vy := Velocities[i*2+1]

		dx := ax - px
		dy := ay - py
		d2 := dx*dx + dy*dy + 400.0
		f := 60000.0 / d2
		vx += dx * f * dt / 20.0
		vy += dy * f * dt / 20.0
		vx *= 0.999
		vy *= 0.999

		px += vx * dt
		py += vy * dt
		if px < 0 {
			px = -px
			vx = -vx
		} else if px > width {
			px = 2*width - px
			vx = -vx
		}
		if py < 0 {
			py = -py
			vy = -vy
		} else if py > height {
			py = 2*height - py
			vy = -vy
		}

		Positions[i*2] = px
		Positions[i*2+1] = py
		Velocities[i*2] = vx
		Velocities[i*2+1] = vy
	}
}

// Energy returns the total kinetic energy — a cheap checksum for tests.
func Energy() float32 {
	var e float32
	for i := 0; i < count; i++ {
		vx := Velocities[i*2]
		vy := Velocities[i*2+1]
		e += vx*vx + vy*vy
	}
	return e / 2
}
