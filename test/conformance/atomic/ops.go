package main

import (
	"fmt"
	"sync/atomic"
)

type node struct{ name string }

func main() {
	var i32 atomic.Int32
	i32.Store(5)
	fmt.Println(i32.Load(), i32.Add(3), i32.Swap(10), i32.Load())
	fmt.Println(i32.CompareAndSwap(10, 11), i32.CompareAndSwap(10, 12), i32.Load())
	fmt.Println(i32.And(0x3), i32.Load(), i32.Or(0x8), i32.Load())

	var i64 atomic.Int64
	i64.Store(1 << 40)
	fmt.Println(i64.Add(-1), i64.Load(), i64.Swap(7), i64.CompareAndSwap(7, 8), i64.Load())

	var u32 atomic.Uint32
	u32.Store(0xfffffff0)
	fmt.Println(u32.Add(0x20), u32.Load(), u32.Or(0xf0), u32.And(0xff), u32.Load())

	var u64 atomic.Uint64
	u64.Store(1 << 40)
	fmt.Println(u64.Add(5), u64.Swap(3), u64.CompareAndSwap(3, 4), u64.Load())

	var up atomic.Uintptr
	up.Store(9)
	fmt.Println(up.Add(1), up.Load(), up.CompareAndSwap(10, 1), up.Swap(2), up.Load())

	var b atomic.Bool
	fmt.Println(b.Load(), b.Swap(true), b.Load(), b.CompareAndSwap(true, false), b.CompareAndSwap(true, false), b.Load())
	b.Store(true)
	fmt.Println(b.Load())

	var p atomic.Pointer[node]
	fmt.Println(p.Load() == nil)
	n1 := &node{"a"}
	n2 := &node{"b"}
	p.Store(n1)
	fmt.Println(p.Load().name, p.CompareAndSwap(n2, n1), p.CompareAndSwap(n1, n2), p.Load().name)
	old := p.Swap(n1)
	fmt.Println(old.name, p.Load().name)

	var v atomic.Value
	fmt.Println(v.Load() == nil)
	v.Store("hello")
	fmt.Println(v.Load(), v.Swap("world"), v.Load())
	fmt.Println(v.CompareAndSwap("nope", "x"), v.CompareAndSwap("world", "x"), v.Load())

	// Function forms.
	var a32 int32 = 1
	fmt.Println(atomic.AddInt32(&a32, 4), atomic.LoadInt32(&a32), atomic.SwapInt32(&a32, 9), atomic.CompareAndSwapInt32(&a32, 9, 10))
	fmt.Println(a32)
	atomic.StoreInt32(&a32, 6)
	fmt.Println(atomic.AndInt32(&a32, 3), atomic.OrInt32(&a32, 8))
	fmt.Println(a32)

	var a64 int64 = 1 << 33
	fmt.Println(atomic.AddInt64(&a64, 1), atomic.LoadInt64(&a64), atomic.SwapInt64(&a64, 2), atomic.CompareAndSwapInt64(&a64, 2, 3))
	fmt.Println(a64)
	atomic.StoreInt64(&a64, 12)
	fmt.Println(atomic.AndInt64(&a64, 4), atomic.OrInt64(&a64, 1))
	fmt.Println(a64)

	var b32 uint32 = 3
	fmt.Println(atomic.AddUint32(&b32, ^uint32(0)), atomic.LoadUint32(&b32), atomic.SwapUint32(&b32, 8), atomic.CompareAndSwapUint32(&b32, 8, 1))
	fmt.Println(b32)
	atomic.StoreUint32(&b32, 6)
	fmt.Println(atomic.AndUint32(&b32, 3), atomic.OrUint32(&b32, 8))
	fmt.Println(b32)

	var b64 uint64 = 1 << 35
	fmt.Println(atomic.AddUint64(&b64, 1), atomic.LoadUint64(&b64), atomic.SwapUint64(&b64, 2), atomic.CompareAndSwapUint64(&b64, 2, 3))
	fmt.Println(b64)
	atomic.StoreUint64(&b64, 12)
	fmt.Println(atomic.AndUint64(&b64, 4), atomic.OrUint64(&b64, 1))
	fmt.Println(b64)

	var bp uintptr = 5
	fmt.Println(atomic.AddUintptr(&bp, 2), atomic.LoadUintptr(&bp), atomic.SwapUintptr(&bp, 1), atomic.CompareAndSwapUintptr(&bp, 1, 3))
	fmt.Println(bp)
	atomic.StoreUintptr(&bp, 6)
	fmt.Println(atomic.AndUintptr(&bp, 3), atomic.OrUintptr(&bp, 8))
	fmt.Println(bp)
}
