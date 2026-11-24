// GoFront test suite — gom signals, computed values, effects and disposal
import { fileURLToPath } from "node:url";
import {
	assertEqual,
	assertThrows,
	compile,
	runInDom,
	section,
	summarize,
	test,
} from "../helpers.js";

// Compiles `body` as the body of main, runs it and returns its printed lines.
function run(body, html = '<div id="app"></div>') {
	const { js, errors } = compile(`package main
${body.decls ?? ""}
func main() {
${body.main ?? body}
}`);
	if (!js) throw new Error(errors.map((e) => e.message).join("\n"));
	return runInDom(js, html).lines;
}

section("gom signals — Signal");

test("Signal Get returns the initial value and Set replaces it", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	println(s.Get())
	s.Set(5)
	println(s.Get())`);
	assertEqual(lines.join(","), "1,5");
});

test("Set runs Subscribe callbacks synchronously with the new value", () => {
	const lines = run(`
	s := gom.NewSignal("a")
	s.Subscribe(func(v string) { println("got", v) })
	s.Set("b")
	println("after set")
	s.Set("c")`);
	assertEqual(lines.join(","), "got b,after set,got c");
});

test("Subscribe does not call back for the current value", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	s.Subscribe(func(v int) { println("got", v) })
	println("done")`);
	assertEqual(lines.join(","), "done");
});

test("the Subscribe unsubscribe function stops the callback", () => {
	const lines = run(`
	s := gom.NewSignal(0)
	stop := s.Subscribe(func(v int) { println("got", v) })
	s.Set(1)
	stop()
	stop()
	s.Set(2)`);
	assertEqual(lines.join(","), "got 1");
});

test("Set with an equal value does not notify", () => {
	const lines = run(`
	s := gom.NewSignal(3)
	s.Subscribe(func(v int) { println("sub", v) })
	gom.Effect(func() { println("effect", s.Get()) })
	s.Set(3)
	s.Set(4)
	s.Set(4)`);
	assertEqual(lines.join(","), "effect 3,sub 4,effect 4");
});

test("Set with NaN again does not notify", () => {
	const lines = run({
		decls: `import "math"`,
		main: `
	s := gom.NewSignal(math.NaN())
	s.Subscribe(func(v float64) { println("sub") })
	s.Set(math.NaN())
	s.Set(1.5)
	println("end")`,
	});
	assertEqual(lines.join(","), "sub,end");
});

test("a signal can hold a slice, compared by identity", () => {
	const lines = run(`
	a := []int{1, 2}
	s := gom.NewSignal(a)
	s.Subscribe(func(v []int) { println("sub", len(v)) })
	s.Set(a)
	s.Set([]int{1, 2, 3})
	println(len(s.Get()))`);
	assertEqual(lines.join(","), "sub 3,3");
});

test("a signal can hold a struct", () => {
	const lines = run({
		decls: "type P struct{ X, Y int }",
		main: `
	s := gom.NewSignal(P{1, 2})
	gom.Effect(func() { println(s.Get().X, s.Get().Y) })
	s.Set(P{3, 4})`,
	});
	assertEqual(lines.join(","), "1 2,3 4");
});

test("Subscribing during a notification is safe", () => {
	const lines = run(`
	s := gom.NewSignal(0)
	var stopLate func()
	s.Subscribe(func(v int) {
		println("first", v)
		stopLate = s.Subscribe(func(w int) { println("late", w) })
	})
	s.Set(1)
	s.Set(2)
	stopLate()`);
	assertEqual(lines.join(","), "first 1,first 2,late 2");
});

test("a callback stopped during a notification does not run", () => {
	const lines = run(`
	s := gom.NewSignal(0)
	var stopB func()
	s.Subscribe(func(v int) { println("a", v); stopB() })
	stopB = s.Subscribe(func(v int) { println("b", v) })
	s.Set(1)
	s.Set(2)`);
	assertEqual(lines.join(","), "a 1,a 2");
});

section("gom signals — Computed");

test("a Computed is not evaluated before it is read", () => {
	const lines = run(`
	s := gom.NewSignal(2)
	n := 0
	c := gom.NewComputed(func() int { n++; return s.Get() * 10 })
	println(n)
	s.Set(3)
	println(n)
	println(c.Get(), n)`);
	assertEqual(lines.join(","), "0,0,30 1");
});

test("a Computed caches across repeated Get while clean", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	n := 0
	c := gom.NewComputed(func() int { n++; return s.Get() + 1 })
	println(c.Get(), c.Get(), c.Get(), n)`);
	assertEqual(lines.join(","), "2 2 2 1");
});

test("a Computed is evaluated again after Set", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	n := 0
	c := gom.NewComputed(func() int { n++; return s.Get() + 1 })
	println(c.Get())
	s.Set(10)
	s.Set(11)
	println(n)
	println(c.Get(), n)
	println(c.Get(), n)`);
	assertEqual(lines.join(","), "2,1,12 2,12 2");
});

test("an unobserved Computed stops listening after it goes stale", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	n := 0
	c := gom.NewComputed(func() int { n++; return s.Get() })
	c.Get()
	for i := 2; i < 6; i++ {
		s.Set(i)
	}
	println(n)
	println(c.Get(), n)`);
	assertEqual(lines.join(","), "1,5 2");
});

test("a Computed can depend on other Computed values", () => {
	const lines = run(`
	a := gom.NewSignal(1)
	b := gom.NewComputed(func() int { return a.Get() + 1 })
	c := gom.NewComputed(func() int { return b.Get() * 10 })
	println(c.Get())
	a.Set(4)
	println(c.Get())`);
	assertEqual(lines.join(","), "20,50");
});

test("Computed Subscribe is notified only when the result changes", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	parity := gom.NewComputed(func() int { return s.Get() % 2 })
	parity.Subscribe(func(v int) { println("parity", v) })
	s.Set(3)
	s.Set(5)
	s.Set(6)
	s.Set(8)
	s.Set(9)`);
	assertEqual(lines.join(","), "parity 0,parity 1");
});

test("an Effect on a Computed runs only when the result changes", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	parity := gom.NewComputed(func() int { return s.Get() % 2 })
	gom.Effect(func() { println("effect", parity.Get()) })
	s.Set(3)
	s.Set(4)
	s.Set(6)
	s.Set(7)`);
	assertEqual(lines.join(","), "effect 1,effect 0,effect 1");
});

test("an observed Computed is evaluated once per change", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	n := 0
	c := gom.NewComputed(func() int { n++; return s.Get() * 2 })
	c.Subscribe(func(v int) {})
	gom.Effect(func() { c.Get() })
	s.Set(2)
	s.Set(3)
	println(n)`);
	assertEqual(lines.join(","), "3");
});

test("an Effect reading a signal and its Computed runs once per Set, fresh", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	double := gom.NewComputed(func() int { return s.Get() * 2 })
	gom.Effect(func() { println(s.Get(), double.Get()) })
	s.Set(2)
	s.Set(3)`);
	assertEqual(lines.join(","), "1 2,2 4,3 6");
});

test("an Effect reading two Computed values of one signal sees both fresh", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	a := gom.NewComputed(func() int { return s.Get() + 1 })
	b := gom.NewComputed(func() int { return s.Get() + 2 })
	gom.Effect(func() { println(a.Get(), b.Get()) })
	s.Set(10)`);
	assertEqual(lines.join(","), "2 3,11 12");
});

test("a Computed that reads itself panics", () => {
	assertThrows(
		() =>
			run(`
	var c *gom.Computed[int]
	c = gom.NewComputed(func() int { return c.Get() + 1 })
	c.Get()`),
		"depends on itself",
	);
});

test("a Computed whose function panics is evaluated again on the next Get", () => {
	const lines = run(`
	s := gom.NewSignal(0)
	c := gom.NewComputed(func() int {
		if s.Get() == 0 {
			panic("zero")
		}
		return 100 / s.Get()
	})
	func() {
		defer func() { println("recovered", recover()) }()
		c.Get()
	}()
	s.Set(4)
	println(c.Get())`);
	assertEqual(lines.join(","), "recovered zero,25");
});

section("gom signals — Effect");

test("an Effect runs at once and again on every change", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	gom.Effect(func() { println("run", s.Get()) })
	s.Set(2)
	s.Set(3)`);
	assertEqual(lines.join(","), "run 1,run 2,run 3");
});

test("an Effect that reads a signal twice subscribes once", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	n := 0
	gom.Effect(func() { n++; _ = s.Get() + s.Get() })
	s.Set(2)
	println(n)`);
	assertEqual(lines.join(","), "2");
});

test("an Effect drops dependencies of branches it no longer takes", () => {
	const lines = run(`
	cond := gom.NewSignal(true)
	a := gom.NewSignal(1)
	b := gom.NewSignal(1)
	n := 0
	gom.Effect(func() {
		n++
		if cond.Get() {
			a.Get()
		} else {
			b.Get()
		}
	})
	b.Set(2)
	println(n)
	cond.Set(false)
	println(n)
	a.Set(2)
	println(n)
	b.Set(3)
	println(n)`);
	assertEqual(lines.join(","), "1,2,2,3");
});

test("the Effect dispose function stops it and is idempotent", () => {
	const lines = run(`
	s := gom.NewSignal(1)
	stop := gom.Effect(func() { println("run", s.Get()) })
	s.Set(2)
	stop()
	stop()
	s.Set(3)`);
	assertEqual(lines.join(","), "run 1,run 2");
});

test("an Effect disposed by an earlier Effect of the same Set does not run", () => {
	const lines = run(`
	s := gom.NewSignal(0)
	var stopB func()
	gom.Effect(func() {
		if s.Get() == 1 {
			stopB()
		}
	})
	stopB = gom.Effect(func() { println("b", s.Get()) })
	s.Set(1)`);
	assertEqual(lines.join(","), "b 0");
});

test("an Effect that Sets another signal updates what depends on it", () => {
	const lines = run(`
	a := gom.NewSignal(1)
	b := gom.NewSignal(0)
	gom.Effect(func() { b.Set(a.Get() * 10) })
	gom.Effect(func() { println("b is", b.Get()) })
	a.Set(2)`);
	assertEqual(lines.join(","), "b is 10,b is 20");
});

test("an Effect that Sets a signal it reads settles when the value stops changing", () => {
	const lines = run(`
	s := gom.NewSignal(5)
	gom.Effect(func() {
		if v := s.Get(); v > 3 {
			s.Set(3)
		}
	})
	println(s.Get())`);
	assertEqual(lines.join(","), "3");
});

test("an Effect that keeps Setting a signal it reads panics with a clear message", () => {
	assertThrows(
		() =>
			run(`
	s := gom.NewSignal(0)
	gom.Effect(func() { s.Set(s.Get() + 1) })`),
		"effects keep triggering each other",
	);
});

test("two Effects that keep Setting each other's signal panic", () => {
	assertThrows(
		() =>
			run(`
	a := gom.NewSignal(0)
	b := gom.NewSignal(0)
	gom.Effect(func() { b.Set(a.Get() + 1) })
	gom.Effect(func() { a.Set(b.Get() + 1) })`),
		"effects keep triggering each other",
	);
});

test("a Subscribe callback that keeps Setting its signal panics", () => {
	assertThrows(
		() =>
			run(`
	s := gom.NewSignal(0)
	s.Subscribe(func(v int) { s.Set(v + 1) })
	s.Set(1)`),
		"effects keep triggering each other",
	);
});

test("after the recursion panic effects still run", () => {
	const lines = run(`
	s := gom.NewSignal(0)
	t := gom.NewSignal(0)
	gom.Effect(func() { println("t", t.Get()) })
	func() {
		defer func() { recover() }()
		gom.Effect(func() { s.Set(s.Get() + 1) })
	}()
	t.Set(1)`);
	assertEqual(lines.join(","), "t 0,t 1");
});

test("reads inside a Subscribe callback are not recorded by the running Effect", () => {
	const lines = run(`
	a := gom.NewSignal(0)
	b := gom.NewSignal(0)
	a.Subscribe(func(v int) { b.Get() })
	n := 0
	gom.Effect(func() { n++; a.Set(n) })
	b.Set(1)
	println(n)`);
	assertEqual(lines.join(","), "1");
});

test("only gom is needed: Signal types can be named in declarations", () => {
	const lines = run({
		decls: `type Store struct{ Count *gom.Signal[int]; Label *gom.Computed[string] }`,
		main: `
	c := gom.NewSignal(1)
	st := Store{Count: c, Label: gom.NewComputed(func() string { return "n=" + String(c.Get()) })}
	gom.Effect(func() { println(st.Label.Get()) })
	st.Count.Set(2)`,
	});
	assertEqual(lines.join(","), "n=1,n=2");
});

section("gom signals — disposal on mount");

const MOUNT_DECLS = `
var runs = map[string]int{}
func watch(name string, s *gom.Signal[int]) gom.Node {
	return gom.NodeFunc(func(parent any) {
		gom.Effect(func() { s.Get(); runs[name]++ })
	})
}`;

test("mounting a root again disposes the effects of the first mount", () => {
	const lines = run({
		decls: MOUNT_DECLS,
		main: `
	s := gom.NewSignal(0)
	gom.Mount("#app", watch("first", s))
	gom.Mount("#app", watch("second", s))
	s.Set(1)
	println(runs["first"], runs["second"])`,
	});
	assertEqual(lines.join(","), "1 2");
});

test("repeated mounts do not accumulate effects", () => {
	const lines = run({
		decls: MOUNT_DECLS,
		main: `
	s := gom.NewSignal(0)
	for i := 0; i < 5; i++ {
		gom.Mount("#app", watch("w", s))
	}
	s.Set(1)
	println(runs["w"])`,
	});
	assertEqual(lines.join(","), "6");
});

test("Mount after MountTo disposes the effects of both", () => {
	const lines = run({
		decls: MOUNT_DECLS,
		main: `
	s := gom.NewSignal(0)
	gom.Mount("#app", watch("a", s))
	gom.MountTo("#app", watch("b", s))
	s.Set(1)
	println(runs["a"], runs["b"])
	gom.Mount("#app", watch("c", s))
	s.Set(2)
	println(runs["a"], runs["b"], runs["c"])`,
	});
	assertEqual(lines.join(","), "2 2,2 2 2");
});

test("MountTo keeps the effects of earlier mounts", () => {
	const lines = run({
		decls: MOUNT_DECLS,
		main: `
	s := gom.NewSignal(0)
	gom.Mount("#app", watch("a", s))
	gom.MountTo("#app", watch("b", s))
	gom.MountTo("#app", watch("c", s))
	s.Set(1)
	println(runs["a"], runs["b"], runs["c"])`,
	});
	assertEqual(lines.join(","), "2 2 2");
});

test("equivalent selectors share one root", () => {
	const lines = run({
		decls: MOUNT_DECLS,
		main: `
	s := gom.NewSignal(0)
	gom.Mount("#app", watch("first", s))
	gom.Mount("div#app", watch("second", s))
	s.Set(1)
	println(runs["first"], runs["second"])`,
	});
	assertEqual(lines.join(","), "1 2");
});

test("mounting one sibling root does not dispose the other", () => {
	const lines = run(
		{
			decls: MOUNT_DECLS,
			main: `
	s := gom.NewSignal(0)
	gom.Mount("#a", watch("a", s))
	gom.Mount("#b", watch("b1", s))
	gom.Mount("#b", watch("b2", s))
	s.Set(1)
	println(runs["a"], runs["b1"], runs["b2"])`,
		},
		'<div id="a"></div><div id="b"></div>',
	);
	assertEqual(lines.join(","), "2 1 2");
});

test("a nested Mount puts its effects in its own root", () => {
	const lines = run(
		{
			decls: `${MOUNT_DECLS}
func outer(s *gom.Signal[int]) gom.Node {
	return gom.NodeFunc(func(parent any) {
		gom.Effect(func() { s.Get(); runs["outer"]++ })
		d := document.createElement("div")
		d.id = "inner"
		parent.appendChild(d)
		gom.Mount("#inner", watch("inner", s))
		gom.Effect(func() { s.Get(); runs["outer2"]++ })
	})
}`,
			main: `
	s := gom.NewSignal(0)
	gom.Mount("#outer", outer(s))
	s.Set(1)
	println(runs["outer"], runs["outer2"], runs["inner"])
	gom.Mount("#inner", watch("inner2", s))
	s.Set(2)
	println(runs["outer"], runs["outer2"], runs["inner"], runs["inner2"])`,
		},
		'<div id="outer"></div>',
	);
	assertEqual(lines.join(","), "2 2 2,3 3 2 2");
});

test("mounting an outer root disposes the roots inside it", () => {
	const lines = run(
		{
			decls: MOUNT_DECLS,
			main: `
	s := gom.NewSignal(0)
	gom.Mount("#inner", watch("inner", s))
	gom.Mount("#outer", watch("outer", s))
	s.Set(1)
	println(runs["inner"], runs["outer"])`,
		},
		'<div id="outer"><div id="inner"></div></div>',
	);
	assertEqual(lines.join(","), "1 2");
});

test("the outer scope is restored after a nested Mount, even on panic", () => {
	const lines = run(
		{
			decls: `${MOUNT_DECLS}
func boom() gom.Node {
	return gom.NodeFunc(func(parent any) { panic("boom") })
}`,
			main: `
	s := gom.NewSignal(0)
	gom.Mount("#app", gom.NodeFunc(func(parent any) {
		func() {
			defer func() { recover() }()
			gom.Mount("#other", boom())
		}()
		gom.Effect(func() { s.Get(); runs["app"]++ })
	}))
	gom.Mount("#other", watch("other", s))
	s.Set(1)
	println(runs["app"], runs["other"])
	gom.Mount("#app", gom.Text("x"))
	s.Set(2)
	println(runs["app"], runs["other"])`,
		},
		'<div id="app"></div><div id="other"></div>',
	);
	assertEqual(lines.join(","), "2 2,2 3");
});

test("an Effect outside any Mount lives until it is disposed", () => {
	const lines = run({
		decls: MOUNT_DECLS,
		main: `
	s := gom.NewSignal(0)
	gom.Effect(func() { s.Get(); runs["free"]++ })
	gom.Mount("#app", gom.Text("x"))
	s.Set(1)
	println(runs["free"])`,
	});
	assertEqual(lines.join(","), "2");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
