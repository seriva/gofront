package main

import "testing"

func TestMin(t *testing.T) { if Min(1, 2) != 1 { t.Errorf("bad %d", Min(1, 2)) } }
