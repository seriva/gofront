//gofront:target wasm
package sim

import (
	"encoding/json"
	"gofront/shared"
	"gofront/simd"
)

// Config defines simulation physics settings loaded from JSON inside the WASM module.
type Config struct {
	Name           string  `json:"name"`
	Drag           float32 `json:"drag"`
	AttractorForce float32 `json:"attractor_force"`
	Soften         float32 `json:"soften"`
}

var currentConfig = Config{
	Name:           "standard",
	Drag:           0.999,
	AttractorForce: 60000.0,
	Soften:         400.0,
}

// DefaultConfigJSON is the initial simulation config in JSON.
const DefaultConfigJSON = `{"name":"standard","drag":0.999,"attractor_force":60000.0,"soften":400.0}`

// LoadConfig parses a JSON configuration string inside the WASM module and applies it.
func LoadConfig(configJSON string) error {
	var cfg Config
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return err
	}
	if cfg.Drag <= 0 || cfg.Drag > 1 {
		cfg.Drag = 0.999
	}
	if cfg.AttractorForce <= 0 {
		cfg.AttractorForce = 60000.0
	}
	if cfg.Soften <= 0 {
		cfg.Soften = 400.0
	}
	currentConfig = cfg
	return nil
}

// ConfigName returns the name of the currently active configuration.
func ConfigName() string {
	return currentConfig.Name
}

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
//
// The interleaved x,y layout puts two particles in one simd.F32x4, so the
// loop moves a pair per iteration; Swizzle adds dx*dx and dy*dy within each
// pair and Select flips the particles that crossed a wall.
func Step(dt float32, ax float32, ay float32, width float32, height float32) {
	attractor := simd.F32x4{ax, ay, ax, ay}
	limit := simd.F32x4{width, height, width, height}
	limit2 := limit.Add(limit)
	zero := simd.Splat(0)
	soften := simd.Splat(currentConfig.Soften)
	force := simd.Splat(currentConfig.AttractorForce)
	vdt := simd.Splat(dt)
	twenty := simd.Splat(20.0)
	drag := simd.Splat(currentConfig.Drag)

	i := 0
	for ; i+2 <= count; i += 2 {
		k := i * 2
		p := simd.LoadF32x4(Positions, k)
		v := simd.LoadF32x4(Velocities, k)

		d := attractor.Sub(p)
		sq := d.Mul(d)
		d2 := sq.Add(sq.Swizzle(1, 0, 3, 2)).Add(soften)
		f := force.Div(d2)
		v = v.Add(d.Mul(f).Mul(vdt).Div(twenty))
		v = v.Mul(drag)
		p = p.Add(v.Mul(vdt))

		// Both masks come from the unbounced position, as in stepOne's
		// `if … else if`: a particle reflected off the low wall is not then
		// tested against the high one.
		low := p.Less(zero)
		high := p.Greater(limit)
		p = simd.Select(low, p.Neg(), p)
		v = simd.Select(low, v.Neg(), v)
		p = simd.Select(high, limit2.Sub(p), p)
		v = simd.Select(high, v.Neg(), v)

		simd.StoreF32x4(Positions, k, p)
		simd.StoreF32x4(Velocities, k, v)
	}
	for ; i < count; i++ {
		stepOne(i, dt, ax, ay, width, height)
	}
}

// stepOne is the scalar form of Step for a single particle.
func stepOne(i int, dt float32, ax float32, ay float32, width float32, height float32) {
	px := Positions[i*2]
	py := Positions[i*2+1]
	vx := Velocities[i*2]
	vy := Velocities[i*2+1]

	dx := ax - px
	dy := ay - py
	d2 := dx*dx + dy*dy + currentConfig.Soften
	f := currentConfig.AttractorForce / d2
	vx += dx * f * dt / 20.0
	vy += dy * f * dt / 20.0
	vx *= currentConfig.Drag
	vy *= currentConfig.Drag

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
