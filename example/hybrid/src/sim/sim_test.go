//gofront:target wasm
package sim

import "testing"

func TestLoadConfig(t *testing.T) {
	t.Cleanup(func() {
		if err := LoadConfig(DefaultConfigJSON); err != nil {
			t.Fatalf("restoring the default config: %v", err)
		}
	})
	err := LoadConfig(`{"name":"custom","drag":0.98,"attractor_force":50000.0,"soften":350.0}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := ConfigName(); got != "custom" {
		t.Errorf("ConfigName() = %q, want %q", got, "custom")
	}

	badErr := LoadConfig(`{invalid json`)
	if badErr == nil {
		t.Errorf("expected error for invalid JSON, got nil")
	}
}

// Runs after TestLoadConfig: its cleanup must have restored the default.
func TestLoadConfigRestoresDefault(t *testing.T) {
	if got := ConfigName(); got != "standard" {
		t.Errorf("ConfigName() after TestLoadConfig = %q, want %q", got, "standard")
	}
}

// energyAfter re-seeds 1001 particles in an 800×600 box and runs 300 steps
// inside a 100×100 box, so many particles bounce off the low and the high
// walls. The SIMD Step and the scalar stepOne must agree.
func energyAfter(useSIMD bool) float32 {
	seed = 0x9e3779b9
	Reset(1001, 800, 600)
	for s := 0; s < 300; s++ {
		if useSIMD {
			Step(0.016, 400, 300, 100, 100)
		} else {
			for i := 0; i < count; i++ {
				stepOne(i, 0.016, 400, 300, 100, 100)
			}
		}
	}
	return Energy()
}

func near(a float32, b float32) bool {
	d := a - b
	return d <= 0.1 && d >= -0.1
}

func TestStepMatchesScalar(t *testing.T) {
	scalar := energyAfter(false)
	if !near(scalar, 668568.7) {
		t.Errorf("scalar energy = %v, want 668568.7", scalar)
	}
	if got := energyAfter(true); !near(got, scalar) {
		t.Errorf("SIMD energy = %v, want the scalar %v", got, scalar)
	}
}
