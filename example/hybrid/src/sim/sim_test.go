//gofront:target wasm
package sim

import "testing"

func TestLoadConfig(t *testing.T) {
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
