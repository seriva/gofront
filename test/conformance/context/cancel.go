package main

import (
	"context"
	"errors"
	"fmt"
)

type customKey string

func main() {
	// 1. Background and TODO
	bg := context.Background()
	todo := context.TODO()
	_, ok1 := bg.Deadline()
	_, ok2 := todo.Deadline()
	fmt.Printf("bg deadline: %v, err: %v\n", ok1, bg.Err())
	fmt.Printf("todo deadline: %v, err: %v\n", ok2, todo.Err())

	// 2. WithCancel
	c1, cancel1 := context.WithCancel(bg)
	fmt.Printf("c1 before cancel err: %v\n", c1.Err())
	cancel1()
	fmt.Printf("c1 after cancel err: %v\n", c1.Err() == context.Canceled)
	// idempotent
	cancel1()
	fmt.Printf("c1 after second cancel err: %v\n", c1.Err() == context.Canceled)

	// 3. WithCancelCause & Cause
	customErr := errors.New("something went wrong")
	cCause, cancelCause := context.WithCancelCause(bg)
	fmt.Printf("cCause before cancel: %v, cause: %v\n", cCause.Err(), context.Cause(cCause))
	cancelCause(customErr)
	fmt.Printf("cCause after cancel: %v, cause: %v\n", cCause.Err() == context.Canceled, context.Cause(cCause) == customErr)

	// 4. Cancel tree: parent -> child -> grandchild
	parent, parentCancel := context.WithCancel(bg)
	child1, _ := context.WithCancel(parent)
	grandchild, _ := context.WithCancel(child1)
	child2, _ := context.WithCancel(parent)

	fmt.Printf("before parent cancel: p=%v c1=%v gc=%v c2=%v\n",
		parent.Err(), child1.Err(), grandchild.Err(), child2.Err())
	parentCancel()
	fmt.Printf("after parent cancel: p=%v c1=%v gc=%v c2=%v\n",
		parent.Err() == context.Canceled,
		child1.Err() == context.Canceled,
		grandchild.Err() == context.Canceled,
		child2.Err() == context.Canceled)

	// 5. Cause propagation in tree
	pCause, pCauseCancel := context.WithCancelCause(bg)
	childWithCause, _ := context.WithCancel(pCause)
	pCauseCancel(customErr)
	fmt.Printf("cause propagation: %v\n", context.Cause(childWithCause) == customErr)

	// 6. WithoutCancel
	p2, p2Cancel := context.WithCancel(bg)
	wc := context.WithoutCancel(p2)
	wcChild, _ := context.WithCancel(wc)
	p2Cancel()
	fmt.Printf("withoutCancel parent: %v, wc: %v, wcChild: %v\n",
		p2.Err() == context.Canceled,
		wc.Err(),
		wcChild.Err())

	// 7. WithValue
	k1 := customKey("k1")
	k2 := customKey("k2")
	vCtx1 := context.WithValue(bg, k1, "val1")
	vCtx2 := context.WithValue(vCtx1, k2, "val2")
	vCtx3 := context.WithValue(vCtx2, k1, "override1")

	fmt.Printf("vCtx2 k1=%v k2=%v\n", vCtx2.Value(k1), vCtx2.Value(k2))
	fmt.Printf("vCtx3 k1=%v k2=%v\n", vCtx3.Value(k1), vCtx3.Value(k2))
	fmt.Printf("unknown key: %v\n", vCtx3.Value("missing"))

	// 8. WithoutCancel preserves values
	vCtx := context.WithValue(bg, k1, "preserved")
	vCtxCancel, _ := context.WithCancel(vCtx)
	wcVal := context.WithoutCancel(vCtxCancel)
	fmt.Printf("withoutCancel value: %v\n", wcVal.Value(k1))
}
