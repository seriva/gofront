//go:build gofront

//gofront:target both

// Package fmtrt is the contract between package fmt and the code the
// compiler generates for each package that formats values.
//
// Go's fmt learns the type of every operand by reflection. Here the compiler
// knows it statically: it describes an operand as an Arg (a kind, the value
// in a field of that kind, and closures that reach the parts of a composite)
// and fmt only reads the description. An operand that arrives through an
// interface is described by the lookups packages register with Register.
package fmtrt

// The kinds of an Arg.
const (
	KNone       = iota // not described: format the value in V
	KBool              // B
	KInt               // I, any signed integer type
	KUint              // U, any unsigned integer type
	KFloat             // R, any float type
	KComplex           // R and Im, any complex type
	KString            // S
	KStruct            // N fields, Field
	KPtr               // Nil, Ptr, Inner
	KSlice             // Nil, N elements, Elem
	KArray             // N elements, Elem
	KMap               // Nil, N entries, Entries
	KFunc              // Nil, Ptr
	KInterface         // V holds the operand, formatted by its dynamic type
	KChan              // Nil, Ptr
	KUnsafePtr         // Nil, Ptr
)

// Stringer, GoStringer and Error-only views of a value, kept apart from
// package fmt so that the generated code needs only this package.
type Stringer interface {
	String() string
}

type GoStringer interface {
	GoString() string
}

// Arg describes one operand.
type Arg struct {
	K    int    // the kind, one of the K constants
	Size int    // the bit size of a number (8, 16, 32, 64 or 0 for int, uint and uintptr)
	T    string // the Go type, as %T prints it
	B    bool
	I    int64
	U    uint64
	R    float64
	Im   float64
	S    string
	V    any // the operand itself, when K is KNone or KInterface

	// The methods of the static type that fmt calls. They are set only
	// where Go would call them: the type's method set holds the method and,
	// for a struct field, the field is exported.
	Err   error
	Str   Stringer
	GoStr GoStringer

	Nil     bool
	N       int
	Ptr     any
	Boxed   bool // Ptr is a pointer to a scalar, boxed anew each time it is put in an Arg
	IsBytes bool                      // a []byte or [N]byte, whose elements are in Bytes
	Bytes   []byte
	Field   func(i int) (string, Arg) // the name and value of field i
	Elem    func(i int) Arg           // element i
	Entries func() []Entry            // the entries of a map
	Inner   func() Arg                // what a non-nil pointer points to
}

// Entry is one key and value of a map.
type Entry struct {
	Key Arg
	Val Arg
}

type registry struct {
	keys    []string
	lookups []func(v any) (Arg, bool)
	scalars []numbered
}

// numbered is a pointer to a scalar that has been given an id; same reports
// whether a value is that pointer.
type numbered struct {
	same func(v any) bool
	id   uint64
}

var reg = &registry{}

func (r *registry) add(key string, f func(v any) (Arg, bool)) {
	for _, k := range r.keys {
		if k == key {
			return
		}
	}
	r.keys = append(r.keys, key)
	r.lookups = append(r.lookups, f)
}

// Register adds a package's lookup, which describes the values of that
// package's types held in an interface. A key registers once, so a call may
// be repeated: it identifies the lookup, and it returns true so that it can
// initialise a package-level variable.
func Register(key string, f func(v any) (Arg, bool)) bool {
	reg.add(key, f)
	return true
}

// Lookup describes a value held in an interface by asking each registered
// lookup in turn.
func Lookup(v any) (Arg, bool) {
	for _, f := range reg.lookups {
		if a, ok := f(v); ok {
			return a, true
		}
	}
	return Arg{}, false
}

// PtrID returns a number that identifies the pointer, function or other
// reference v; 0 for nil.
func PtrID(v any) uint64 {
	if v == nil {
		return 0
	}
	return ptrID(v)
}

// ArgPtrID returns the identity number of the pointer, function or channel
// that a holds. A pointer to a scalar is boxed anew each time it is put in an
// Arg and the host would see a different object, so those are matched by
// equality against the ones already numbered.
func ArgPtrID(a Arg) uint64 {
	if !a.Boxed {
		return PtrID(a.Ptr)
	}
	p := a.Ptr
	for _, n := range reg.scalars {
		if n.same(p) {
			return n.id
		}
	}
	id := PtrID(p)
	reg.remember(p, id)
	return id
}

func (r *registry) remember(p any, id uint64) {
	r.scalars = append(r.scalars, numbered{func(v any) bool { return v == p }, id})
}

// ptrID is the host's stable identity number for an object.
//
//gofront:intrinsic fmt_ptr_id
func ptrID(v any) uint64
