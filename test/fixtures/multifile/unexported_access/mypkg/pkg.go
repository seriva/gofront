package mypkg

func Exported() int {
    return helper()
}

func helper() int {
    return 42
}
