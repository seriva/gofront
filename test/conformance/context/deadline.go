package main

import (
	"context"
	"errors"
	"fmt"
	"time"
)

func main() {
	bg := context.Background()

	// 1. Expired deadline
	past := time.Now().Add(-10 * time.Minute)
	ctxPast, cancelPast := context.WithDeadline(bg, past)
	defer cancelPast()
	dl, ok := ctxPast.Deadline()
	fmt.Printf("ctxPast ok: %v, dl == past: %v, err: %v\n", ok, dl.Equal(past), ctxPast.Err() == context.DeadlineExceeded)

	// 2. Future deadline
	future := time.Now().Add(10 * time.Hour)
	ctxFuture, cancelFuture := context.WithDeadline(bg, future)
	dlFut, okFut := ctxFuture.Deadline()
	fmt.Printf("ctxFuture ok: %v, dl == future: %v, err before: %v\n", okFut, dlFut.Equal(future), ctxFuture.Err())
	cancelFuture()
	fmt.Printf("ctxFuture err after cancel: %v\n", ctxFuture.Err() == context.Canceled)

	// 3. WithDeadlineCause
	customCause := errors.New("custom deadline cause")
	ctxCause, cancelCause := context.WithDeadlineCause(bg, past, customCause)
	defer cancelCause()
	fmt.Printf("ctxCause err: %v, cause: %v\n", ctxCause.Err() == context.DeadlineExceeded, context.Cause(ctxCause) == customCause)

	// 4. WithTimeout and WithTimeoutCause (negative timeout -> already expired)
	ctxTimeout, cancelTimeout := context.WithTimeout(bg, -5*time.Second)
	defer cancelTimeout()
	fmt.Printf("ctxTimeout err: %v\n", ctxTimeout.Err() == context.DeadlineExceeded)

	ctxTimeoutCause, cancelTimeoutCause := context.WithTimeoutCause(bg, -5*time.Second, customCause)
	defer cancelTimeoutCause()
	fmt.Printf("ctxTimeoutCause err: %v, cause: %v\n", ctxTimeoutCause.Err() == context.DeadlineExceeded, context.Cause(ctxTimeoutCause) == customCause)

	// 5. AfterFunc: stop before cancellation
	ctx1, cancel1 := context.WithCancel(bg)
	fired1 := 0
	stop1 := context.AfterFunc(ctx1, func() {
		fired1++
	})
	stopped1 := stop1()
	cancel1()
	stopped1Again := stop1()
	fmt.Printf("afterFunc stopped: %v, stoppedAgain: %v, fired: %d\n", stopped1, stopped1Again, fired1)

	// 6. AfterFunc: fired on cancellation
	ctx2, cancel2 := context.WithCancel(bg)
	fired2 := 0
	stop2 := context.AfterFunc(ctx2, func() {
		fired2 = 1
	})
	cancel2()
	for fired2 == 0 {
	}
	stopped2 := stop2()
	fmt.Printf("afterFunc fired: %d, stoppedAfterFire: %v\n", fired2, stopped2)

	// 7. AfterFunc: fired on deadline exceeded
	fired3 := 0
	ctx3, cancel3 := context.WithDeadline(bg, past)
	defer cancel3()
	stop3 := context.AfterFunc(ctx3, func() {
		fired3 = 1
	})
	for fired3 == 0 {
	}
	stopped3 := stop3()
	fmt.Printf("afterFunc on expired fired: %d, stopped: %v\n", fired3, stopped3)
}
