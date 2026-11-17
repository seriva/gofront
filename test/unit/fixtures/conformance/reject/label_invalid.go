package main

func main() {
outer:
	for i := 0; i < 2; i++ {
		switch i {
		case 0:
			continue outer
		}
	}
sw:
	switch {
	case true:
		for {
			continue sw // ERROR "invalid continue label sw"
		}
	}
blk:
	if true {
		for {
			break blk // ERROR "invalid break label blk"
		}
	}
	for {
		continue nowhere // ERROR "continue label not defined: nowhere"
	}
}

func other() {
a:
	for {
		func() {
			break a // ERROR "break label not defined: a"
		}()
		break a
	}
b:
	for {
		break b
	}
b: // ERROR "label b already defined"
	for {
		break b
	}
}
