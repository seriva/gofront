//gofront:target wasm
package lib

import "cmp"

func Run() int { return cmp.Compare(3, 1) }
