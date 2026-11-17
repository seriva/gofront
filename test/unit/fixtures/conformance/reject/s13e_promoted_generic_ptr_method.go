package main

type Base[T any] struct{ v T }

func (b *Base[T]) Set(v T) { b.v = v }

func (b Base[T]) Get() T { return b.v }

type WrapVal[T any] struct{ Base[T] }

type WrapConcrete struct{ Base[int] }

type WrapPtr[T any] struct{ *Base[T] }

func main() {
	WrapVal[int]{}.Set(1) // ERROR "cannot call pointer method Set on WrapVal[int]"
	fn := WrapVal[int]{}.Set // ERROR "cannot call pointer method Set on WrapVal[int]"
	_ = fn
	WrapConcrete{}.Set(1) // ERROR "cannot call pointer method Set on WrapConcrete"
	var w WrapVal[int]
	w.Set(1)
	pw := &WrapVal[int]{}
	pw.Set(2)
	_ = WrapVal[int]{}.Get()
	WrapPtr[int]{Base: &Base[int]{}}.Set(3)
}
