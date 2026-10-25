package main

import (
	"container/list"
	"fmt"
)

func printList(l *list.List) {
	fmt.Print("list [")
	for e := l.Front(); e != nil; e = e.Next() {
		fmt.Printf(" %v", e.Value)
	}
	fmt.Println(" ]")
}

func printListReverse(l *list.List) {
	fmt.Print("reverse [")
	for e := l.Back(); e != nil; e = e.Prev() {
		fmt.Printf(" %v", e.Value)
	}
	fmt.Println(" ]")
}

func main() {
	l := list.New()
	e4 := l.PushBack(4)
	e1 := l.PushFront(1)
	l.InsertBefore(3, e4)
	l.InsertAfter(2, e1)

	fmt.Println("len:", l.Len())
	printList(l)
	printListReverse(l)

	l.MoveToFront(e4)
	fmt.Print("moveToFront(4): ")
	printList(l)

	l.MoveToBack(e1)
	fmt.Print("moveToBack(1): ")
	printList(l)

	l.MoveBefore(e1, e4)
	fmt.Print("moveBefore(1, 4): ")
	printList(l)

	l.MoveAfter(e1, e4)
	fmt.Print("moveAfter(1, 4): ")
	printList(l)

	removed := l.Remove(e4)
	fmt.Println("removed:", removed)
	printList(l)

	// Test PushBackList and PushFrontList
	l2 := list.New()
	l2.PushBack(10)
	l2.PushBack(20)

	l.PushBackList(l2)
	fmt.Print("after PushBackList: ")
	printList(l)

	l.PushFrontList(l2)
	fmt.Print("after PushFrontList: ")
	printList(l)

	// Test zero-value List lazyInit
	var zeroList list.List
	zeroList.PushBack("zero_a")
	zeroList.PushFront("zero_b")
	fmt.Println("zeroList len:", zeroList.Len())
	printList(&zeroList)
}
