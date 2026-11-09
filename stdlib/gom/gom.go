//go:build gofront

//gofront:target js

// Package gom builds DOM trees from Go values. A Node mounts itself into a
// parent element; templ components are Nodes too. It is only available to js
// packages and needs no import.
package gom

// A Node adds itself to the DOM element parent. refs, when not nil, is the
// map that `ref="key"` attributes of templ components fill with elements.
type Node interface {
	Mount(parent any, refs any)
}

// NodeFunc adapts a function that mounts into an element to a Node.
type NodeFunc func(parent any)

func (f NodeFunc) Mount(parent any, refs any) {
	f(parent)
}

// Group mounts its nodes one after another into the same parent.
type Group []Node

func (g Group) Mount(parent any, refs any) {
	for _, n := range g {
		if n != nil {
			n.Mount(parent, refs)
		}
	}
}

type element struct {
	tag      string
	children []Node
}

func (e *element) Mount(parent any, refs any) {
	el := document.createElement(e.tag)
	for _, c := range e.children {
		if c != nil {
			c.Mount(el, refs)
		}
	}
	parent.appendChild(el)
}

type text struct{ s string }

func (t *text) Mount(parent any, refs any) {
	parent.appendChild(document.createTextNode(t.s))
}

type attr struct{ name, value string }

func (a *attr) Mount(el any, refs any) {
	el.setAttribute(a.name, a.value)
}

type prop struct{ name, value string }

func (p *prop) Mount(el any, refs any) {
	el[p.name] = p.value
}

type style struct{ css string }

func (s *style) Mount(parent any, refs any) {
	el := document.createElement("style")
	el.textContent = s.css
	parent.appendChild(el)
}

// El is an element with the given tag, attributes and children.
func El(tag string, children ...Node) Node {
	return &element{tag: tag, children: children}
}

// Text is a text node.
func Text(s string) Node {
	return &text{s: s}
}

// Attr sets an attribute.
func Attr(name, value string) Node {
	return &attr{name: name, value: value}
}

// DataAttr sets the attribute data-<key>.
func DataAttr(key, value string) Node {
	return &attr{name: "data-" + key, value: value}
}

// If is n when cond holds, and an empty node otherwise.
func If(cond bool, n Node) Node {
	if cond {
		return n
	}
	return Group{}
}

// Map applies f to every element of s; the nodes mount in order.
func Map[T any](s []T, f func(T) Node) Node {
	g := make(Group, 0, len(s))
	for _, v := range s {
		g = append(g, f(v))
	}
	return g
}

// Style is a <style> element with the given CSS text.
func Style(css string) Node {
	return &style{css: css}
}

func refOf(refs []any) any {
	if len(refs) > 0 {
		return refs[0]
	}
	return nil
}

// Mount replaces the content of the element matching the selector with node.
// The optional refs map receives the elements of templ `ref` attributes.
func Mount(sel string, node Node, refs ...any) {
	el := document.querySelector(sel)
	el.innerHTML = ""
	node.Mount(el, refOf(refs))
}

// MountTo is like Mount but keeps the existing content.
func MountTo(sel string, node Node, refs ...any) {
	node.Mount(document.querySelector(sel), refOf(refs))
}

// Elements.

func Div(children ...Node) Node { return El("div", children...) }

func Section(children ...Node) Node { return El("section", children...) }

func Article(children ...Node) Node { return El("article", children...) }

func Aside(children ...Node) Node { return El("aside", children...) }

func Header(children ...Node) Node { return El("header", children...) }

func Footer(children ...Node) Node { return El("footer", children...) }

func Main(children ...Node) Node { return El("main", children...) }

func Nav(children ...Node) Node { return El("nav", children...) }

func Figure(children ...Node) Node { return El("figure", children...) }

func H1(children ...Node) Node { return El("h1", children...) }

func H2(children ...Node) Node { return El("h2", children...) }

func H3(children ...Node) Node { return El("h3", children...) }

func H4(children ...Node) Node { return El("h4", children...) }

func H5(children ...Node) Node { return El("h5", children...) }

func H6(children ...Node) Node { return El("h6", children...) }

func Span(children ...Node) Node { return El("span", children...) }

func A(children ...Node) Node { return El("a", children...) }

func Strong(children ...Node) Node { return El("strong", children...) }

func Em(children ...Node) Node { return El("em", children...) }

func Code(children ...Node) Node { return El("code", children...) }

func Pre(children ...Node) Node { return El("pre", children...) }

func Small(children ...Node) Node { return El("small", children...) }

func Mark(children ...Node) Node { return El("mark", children...) }

func P(children ...Node) Node { return El("p", children...) }

func Br(children ...Node) Node { return El("br", children...) }

func Hr(children ...Node) Node { return El("hr", children...) }

func Ul(children ...Node) Node { return El("ul", children...) }

func Ol(children ...Node) Node { return El("ol", children...) }

func Li(children ...Node) Node { return El("li", children...) }

func Dl(children ...Node) Node { return El("dl", children...) }

func Dt(children ...Node) Node { return El("dt", children...) }

func Dd(children ...Node) Node { return El("dd", children...) }

func Form(children ...Node) Node { return El("form", children...) }

func Input(children ...Node) Node { return El("input", children...) }

func Button(children ...Node) Node { return El("button", children...) }

func Textarea(children ...Node) Node { return El("textarea", children...) }

func Select(children ...Node) Node { return El("select", children...) }

func Option(children ...Node) Node { return El("option", children...) }

func Label(children ...Node) Node { return El("label", children...) }

func Fieldset(children ...Node) Node { return El("fieldset", children...) }

func Legend(children ...Node) Node { return El("legend", children...) }

func Img(children ...Node) Node { return El("img", children...) }

func Video(children ...Node) Node { return El("video", children...) }

func Audio(children ...Node) Node { return El("audio", children...) }

func Canvas(children ...Node) Node { return El("canvas", children...) }

func Table(children ...Node) Node { return El("table", children...) }

func Thead(children ...Node) Node { return El("thead", children...) }

func Tbody(children ...Node) Node { return El("tbody", children...) }

func Tfoot(children ...Node) Node { return El("tfoot", children...) }

func Tr(children ...Node) Node { return El("tr", children...) }

func Th(children ...Node) Node { return El("th", children...) }

func Td(children ...Node) Node { return El("td", children...) }

// Attributes.

func For(v string) Node { return Attr("for", v) }

func Name(v string) Node { return Attr("name", v) }

func Value(v string) Node { return Attr("value", v) }

func Target(v string) Node { return Attr("target", v) }

func Rel(v string) Node { return Attr("rel", v) }

func Alt(v string) Node { return Attr("alt", v) }

func Title(v string) Node { return Attr("title", v) }

func Lang(v string) Node { return Attr("lang", v) }

func Action(v string) Node { return Attr("action", v) }

func Method(v string) Node { return Attr("method", v) }

func AutoComplete(v string) Node { return Attr("autocomplete", v) }

func Draggable(v string) Node { return Attr("draggable", v) }

func Role(v string) Node { return Attr("role", v) }

func StyleAttr(v string) Node { return Attr("style", v) }

func AriaLabel(v string) Node { return Attr("aria-label", v) }

func Disabled() Node { return Attr("disabled", "") }

func Checked() Node { return Attr("checked", "") }

func Selected() Node { return Attr("selected", "") }

func Readonly() Node { return Attr("readonly", "") }

// Properties.

func Class(v string) Node { return &prop{name: "className", value: v} }

func Type(v string) Node { return &prop{name: "type", value: v} }

func Href(v string) Node { return &prop{name: "href", value: v} }

func Src(v string) Node { return &prop{name: "src", value: v} }

func Placeholder(v string) Node { return &prop{name: "placeholder", value: v} }
