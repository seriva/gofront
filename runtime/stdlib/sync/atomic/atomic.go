//go:build gofront

//gofront:target both

// Package atomic provides the atomic memory primitives of Go's sync/atomic.
//
// GoFront programs run on a single thread, so every operation here is a plain
// read-modify-write and trivially atomic. The package exists so code written
// for Go compiles unchanged. In `js` and `both` packages the 64-bit types hold
// a JavaScript number and are exact only up to 2^53.
package atomic

// Int32 is an atomic int32. The zero value is zero.
type Int32 struct {
	v int32
}

// Load atomically loads and returns the value stored in x.
func (x *Int32) Load() int32 { return x.v }

// Store atomically stores val into x.
func (x *Int32) Store(val int32) { x.v = val }

// Swap atomically stores new into x and returns the previous value.
func (x *Int32) Swap(nv int32) (old int32) {
	old = x.v
	x.v = nv
	return old
}

// CompareAndSwap executes the compare-and-swap operation for x.
func (x *Int32) CompareAndSwap(old, nv int32) (swapped bool) {
	if x.v == old {
		x.v = nv
		return true
	}
	return false
}

// Add atomically adds delta to x and returns the new value.
func (x *Int32) Add(delta int32) (nv int32) {
	x.v += delta
	return x.v
}

// And atomically performs a bitwise AND operation on x using the bitmask
// provided as mask and returns the old value.
func (x *Int32) And(mask int32) (old int32) {
	old = x.v
	x.v &= mask
	return old
}

// Or atomically performs a bitwise OR operation on x using the bitmask
// provided as mask and returns the old value.
func (x *Int32) Or(mask int32) (old int32) {
	old = x.v
	x.v |= mask
	return old
}

// SwapInt32 atomically stores new into *addr and returns the previous *addr value.
func SwapInt32(addr *int32, nv int32) (old int32) {
	old = *addr
	*addr = nv
	return old
}

// CompareAndSwapInt32 executes the compare-and-swap operation for int32 values.
func CompareAndSwapInt32(addr *int32, old, nv int32) (swapped bool) {
	if *addr == old {
		*addr = nv
		return true
	}
	return false
}

// AddInt32 atomically adds delta to *addr and returns the new value.
func AddInt32(addr *int32, delta int32) (nv int32) {
	*addr += delta
	return *addr
}

// AndInt32 atomically performs a bitwise AND operation on *addr using the
// bitmask provided as mask and returns the old value.
func AndInt32(addr *int32, mask int32) (old int32) {
	old = *addr
	*addr &= mask
	return old
}

// OrInt32 atomically performs a bitwise OR operation on *addr using the
// bitmask provided as mask and returns the old value.
func OrInt32(addr *int32, mask int32) (old int32) {
	old = *addr
	*addr |= mask
	return old
}

// LoadInt32 atomically loads *addr.
func LoadInt32(addr *int32) (val int32) { return *addr }

// StoreInt32 atomically stores val into *addr.
func StoreInt32(addr *int32, val int32) { *addr = val }

// Int64 is an atomic int64. The zero value is zero.
type Int64 struct {
	v int64
}

// Load atomically loads and returns the value stored in x.
func (x *Int64) Load() int64 { return x.v }

// Store atomically stores val into x.
func (x *Int64) Store(val int64) { x.v = val }

// Swap atomically stores new into x and returns the previous value.
func (x *Int64) Swap(nv int64) (old int64) {
	old = x.v
	x.v = nv
	return old
}

// CompareAndSwap executes the compare-and-swap operation for x.
func (x *Int64) CompareAndSwap(old, nv int64) (swapped bool) {
	if x.v == old {
		x.v = nv
		return true
	}
	return false
}

// Add atomically adds delta to x and returns the new value.
func (x *Int64) Add(delta int64) (nv int64) {
	x.v += delta
	return x.v
}

// And atomically performs a bitwise AND operation on x using the bitmask
// provided as mask and returns the old value.
func (x *Int64) And(mask int64) (old int64) {
	old = x.v
	x.v &= mask
	return old
}

// Or atomically performs a bitwise OR operation on x using the bitmask
// provided as mask and returns the old value.
func (x *Int64) Or(mask int64) (old int64) {
	old = x.v
	x.v |= mask
	return old
}

// SwapInt64 atomically stores new into *addr and returns the previous *addr value.
func SwapInt64(addr *int64, nv int64) (old int64) {
	old = *addr
	*addr = nv
	return old
}

// CompareAndSwapInt64 executes the compare-and-swap operation for int64 values.
func CompareAndSwapInt64(addr *int64, old, nv int64) (swapped bool) {
	if *addr == old {
		*addr = nv
		return true
	}
	return false
}

// AddInt64 atomically adds delta to *addr and returns the new value.
func AddInt64(addr *int64, delta int64) (nv int64) {
	*addr += delta
	return *addr
}

// AndInt64 atomically performs a bitwise AND operation on *addr using the
// bitmask provided as mask and returns the old value.
func AndInt64(addr *int64, mask int64) (old int64) {
	old = *addr
	*addr &= mask
	return old
}

// OrInt64 atomically performs a bitwise OR operation on *addr using the
// bitmask provided as mask and returns the old value.
func OrInt64(addr *int64, mask int64) (old int64) {
	old = *addr
	*addr |= mask
	return old
}

// LoadInt64 atomically loads *addr.
func LoadInt64(addr *int64) (val int64) { return *addr }

// StoreInt64 atomically stores val into *addr.
func StoreInt64(addr *int64, val int64) { *addr = val }

// Uint32 is an atomic uint32. The zero value is zero.
type Uint32 struct {
	v uint32
}

// Load atomically loads and returns the value stored in x.
func (x *Uint32) Load() uint32 { return x.v }

// Store atomically stores val into x.
func (x *Uint32) Store(val uint32) { x.v = val }

// Swap atomically stores new into x and returns the previous value.
func (x *Uint32) Swap(nv uint32) (old uint32) {
	old = x.v
	x.v = nv
	return old
}

// CompareAndSwap executes the compare-and-swap operation for x.
func (x *Uint32) CompareAndSwap(old, nv uint32) (swapped bool) {
	if x.v == old {
		x.v = nv
		return true
	}
	return false
}

// Add atomically adds delta to x and returns the new value.
func (x *Uint32) Add(delta uint32) (nv uint32) {
	x.v += delta
	return x.v
}

// And atomically performs a bitwise AND operation on x using the bitmask
// provided as mask and returns the old value.
func (x *Uint32) And(mask uint32) (old uint32) {
	old = x.v
	x.v &= mask
	return old
}

// Or atomically performs a bitwise OR operation on x using the bitmask
// provided as mask and returns the old value.
func (x *Uint32) Or(mask uint32) (old uint32) {
	old = x.v
	x.v |= mask
	return old
}

// SwapUint32 atomically stores new into *addr and returns the previous *addr value.
func SwapUint32(addr *uint32, nv uint32) (old uint32) {
	old = *addr
	*addr = nv
	return old
}

// CompareAndSwapUint32 executes the compare-and-swap operation for uint32 values.
func CompareAndSwapUint32(addr *uint32, old, nv uint32) (swapped bool) {
	if *addr == old {
		*addr = nv
		return true
	}
	return false
}

// AddUint32 atomically adds delta to *addr and returns the new value.
func AddUint32(addr *uint32, delta uint32) (nv uint32) {
	*addr += delta
	return *addr
}

// AndUint32 atomically performs a bitwise AND operation on *addr using the
// bitmask provided as mask and returns the old value.
func AndUint32(addr *uint32, mask uint32) (old uint32) {
	old = *addr
	*addr &= mask
	return old
}

// OrUint32 atomically performs a bitwise OR operation on *addr using the
// bitmask provided as mask and returns the old value.
func OrUint32(addr *uint32, mask uint32) (old uint32) {
	old = *addr
	*addr |= mask
	return old
}

// LoadUint32 atomically loads *addr.
func LoadUint32(addr *uint32) (val uint32) { return *addr }

// StoreUint32 atomically stores val into *addr.
func StoreUint32(addr *uint32, val uint32) { *addr = val }

// Uint64 is an atomic uint64. The zero value is zero.
type Uint64 struct {
	v uint64
}

// Load atomically loads and returns the value stored in x.
func (x *Uint64) Load() uint64 { return x.v }

// Store atomically stores val into x.
func (x *Uint64) Store(val uint64) { x.v = val }

// Swap atomically stores new into x and returns the previous value.
func (x *Uint64) Swap(nv uint64) (old uint64) {
	old = x.v
	x.v = nv
	return old
}

// CompareAndSwap executes the compare-and-swap operation for x.
func (x *Uint64) CompareAndSwap(old, nv uint64) (swapped bool) {
	if x.v == old {
		x.v = nv
		return true
	}
	return false
}

// Add atomically adds delta to x and returns the new value.
func (x *Uint64) Add(delta uint64) (nv uint64) {
	x.v += delta
	return x.v
}

// And atomically performs a bitwise AND operation on x using the bitmask
// provided as mask and returns the old value.
func (x *Uint64) And(mask uint64) (old uint64) {
	old = x.v
	x.v &= mask
	return old
}

// Or atomically performs a bitwise OR operation on x using the bitmask
// provided as mask and returns the old value.
func (x *Uint64) Or(mask uint64) (old uint64) {
	old = x.v
	x.v |= mask
	return old
}

// SwapUint64 atomically stores new into *addr and returns the previous *addr value.
func SwapUint64(addr *uint64, nv uint64) (old uint64) {
	old = *addr
	*addr = nv
	return old
}

// CompareAndSwapUint64 executes the compare-and-swap operation for uint64 values.
func CompareAndSwapUint64(addr *uint64, old, nv uint64) (swapped bool) {
	if *addr == old {
		*addr = nv
		return true
	}
	return false
}

// AddUint64 atomically adds delta to *addr and returns the new value.
func AddUint64(addr *uint64, delta uint64) (nv uint64) {
	*addr += delta
	return *addr
}

// AndUint64 atomically performs a bitwise AND operation on *addr using the
// bitmask provided as mask and returns the old value.
func AndUint64(addr *uint64, mask uint64) (old uint64) {
	old = *addr
	*addr &= mask
	return old
}

// OrUint64 atomically performs a bitwise OR operation on *addr using the
// bitmask provided as mask and returns the old value.
func OrUint64(addr *uint64, mask uint64) (old uint64) {
	old = *addr
	*addr |= mask
	return old
}

// LoadUint64 atomically loads *addr.
func LoadUint64(addr *uint64) (val uint64) { return *addr }

// StoreUint64 atomically stores val into *addr.
func StoreUint64(addr *uint64, val uint64) { *addr = val }

// Uintptr is an atomic uintptr. The zero value is zero.
type Uintptr struct {
	v uintptr
}

// Load atomically loads and returns the value stored in x.
func (x *Uintptr) Load() uintptr { return x.v }

// Store atomically stores val into x.
func (x *Uintptr) Store(val uintptr) { x.v = val }

// Swap atomically stores new into x and returns the previous value.
func (x *Uintptr) Swap(nv uintptr) (old uintptr) {
	old = x.v
	x.v = nv
	return old
}

// CompareAndSwap executes the compare-and-swap operation for x.
func (x *Uintptr) CompareAndSwap(old, nv uintptr) (swapped bool) {
	if x.v == old {
		x.v = nv
		return true
	}
	return false
}

// Add atomically adds delta to x and returns the new value.
func (x *Uintptr) Add(delta uintptr) (nv uintptr) {
	x.v += delta
	return x.v
}

// And atomically performs a bitwise AND operation on x using the bitmask
// provided as mask and returns the old value.
func (x *Uintptr) And(mask uintptr) (old uintptr) {
	old = x.v
	x.v &= mask
	return old
}

// Or atomically performs a bitwise OR operation on x using the bitmask
// provided as mask and returns the old value.
func (x *Uintptr) Or(mask uintptr) (old uintptr) {
	old = x.v
	x.v |= mask
	return old
}

// SwapUintptr atomically stores new into *addr and returns the previous *addr value.
func SwapUintptr(addr *uintptr, nv uintptr) (old uintptr) {
	old = *addr
	*addr = nv
	return old
}

// CompareAndSwapUintptr executes the compare-and-swap operation for uintptr values.
func CompareAndSwapUintptr(addr *uintptr, old, nv uintptr) (swapped bool) {
	if *addr == old {
		*addr = nv
		return true
	}
	return false
}

// AddUintptr atomically adds delta to *addr and returns the new value.
func AddUintptr(addr *uintptr, delta uintptr) (nv uintptr) {
	*addr += delta
	return *addr
}

// AndUintptr atomically performs a bitwise AND operation on *addr using the
// bitmask provided as mask and returns the old value.
func AndUintptr(addr *uintptr, mask uintptr) (old uintptr) {
	old = *addr
	*addr &= mask
	return old
}

// OrUintptr atomically performs a bitwise OR operation on *addr using the
// bitmask provided as mask and returns the old value.
func OrUintptr(addr *uintptr, mask uintptr) (old uintptr) {
	old = *addr
	*addr |= mask
	return old
}

// LoadUintptr atomically loads *addr.
func LoadUintptr(addr *uintptr) (val uintptr) { return *addr }

// StoreUintptr atomically stores val into *addr.
func StoreUintptr(addr *uintptr, val uintptr) { *addr = val }

// A Bool is an atomic boolean value. The zero value is false.
type Bool struct {
	v bool
}

// Load atomically loads and returns the value stored in x.
func (x *Bool) Load() bool { return x.v }

// Store atomically stores val into x.
func (x *Bool) Store(val bool) { x.v = val }

// Swap atomically stores new into x and returns the previous value.
func (x *Bool) Swap(nv bool) (old bool) {
	old = x.v
	x.v = nv
	return old
}

// CompareAndSwap executes the compare-and-swap operation for the boolean value x.
func (x *Bool) CompareAndSwap(old, nv bool) (swapped bool) {
	if x.v == old {
		x.v = nv
		return true
	}
	return false
}

// A Pointer is an atomic pointer of type *T. The zero value is a nil *T.
type Pointer[T any] struct {
	v *T
}

// Load atomically loads and returns the value stored in x.
func (x *Pointer[T]) Load() *T { return x.v }

// Store atomically stores val into x.
func (x *Pointer[T]) Store(val *T) { x.v = val }

// Swap atomically stores new into x and returns the previous value.
func (x *Pointer[T]) Swap(nv *T) *T {
	prev := x.v
	x.v = nv
	return prev
}

// CompareAndSwap executes the compare-and-swap operation for x.
func (x *Pointer[T]) CompareAndSwap(old, nv *T) bool {
	if x.v == old {
		x.v = nv
		return true
	}
	return false
}

// A Value provides an atomic load and store of a consistently typed value.
// The zero value for a Value returns nil from Load. Unlike Go, Store and
// Swap do not check that every stored value has the same concrete type.
type Value struct {
	v any
}

// Load returns the value set by the most recent Store.
// It returns nil if there has been no call to Store for this Value.
func (v *Value) Load() (val any) { return v.v }

// Store sets the value of the Value v to val. Store panics if val is nil.
func (v *Value) Store(val any) {
	if val == nil {
		panic("sync/atomic: store of nil value into Value")
	}
	v.v = val
}

// Swap stores new into Value and returns the previous value. It returns nil
// if the Value is empty. Swap panics if new is nil.
func (v *Value) Swap(nv any) (old any) {
	if nv == nil {
		panic("sync/atomic: swap of nil value into Value")
	}
	old = v.v
	v.v = nv
	return old
}

// CompareAndSwap executes the compare-and-swap operation for the Value.
// It panics if new is nil.
func (v *Value) CompareAndSwap(old, nv any) (swapped bool) {
	if nv == nil {
		panic("sync/atomic: compare and swap of nil value into Value")
	}
	if v.v != old {
		return false
	}
	v.v = nv
	return true
}
