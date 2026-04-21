package gom

// Node is the core interface — any value that can be mounted into a DOM parent.
type Node interface {
	Mount(parent any)
}

// NodeFunc is a named function type that satisfies Node.
// Any func(parent any) can be converted to a NodeFunc and used as a Node.
type NodeFunc func(parent any)

func (n NodeFunc) Mount(parent any) { n(parent) }

// Group is an ordered slice of Nodes that mounts each child in sequence.
type Group []Node

func (g Group) Mount(parent any) {
	for _, n := range g {
		if n != nil {
			n.Mount(parent)
		}
	}
}

// attrNode is an internal type for attribute/property nodes.
type attrNode struct {
	name  string
	value string
}

func (a attrNode) Mount(parent any) {
	parent.setAttribute(a.name, a.value)
}

// El creates a DOM element node with the given tag and children.
// Children may be element nodes (mounted as children) or attribute nodes
// (applied via setAttribute — use Attr, Class, ID, etc.).
func El(tag string, children ...Node) Node {
	return NodeFunc(func(parent any) {
		el := document.createElement(tag)
		for _, c := range children {
			if c != nil {
				c.Mount(el)
			}
		}
		parent.appendChild(el)
	})
}

// Text creates a DOM text node. The browser handles escaping automatically,
// so this is safe against XSS.
func Text(s string) Node {
	return NodeFunc(func(parent any) {
		parent.appendChild(document.createTextNode(s))
	})
}

// Attr creates a node that calls setAttribute(name, value) on its parent element.
func Attr(name string, value string) Node {
	return attrNode{name: name, value: value}
}

// Class is shorthand for Attr("class", v).
func Class(v string) Node { return Attr("class", v) }

// ID is shorthand for Attr("id", v).
func ID(v string) Node { return Attr("id", v) }

// Href is shorthand for Attr("href", v).
func Href(v string) Node { return Attr("href", v) }

// Src is shorthand for Attr("src", v).
func Src(v string) Node { return Attr("src", v) }

// Type is shorthand for Attr("type", v).
func Type(v string) Node { return Attr("type", v) }

// Placeholder is shorthand for Attr("placeholder", v).
func Placeholder(v string) Node { return Attr("placeholder", v) }

// DataAttr creates a data-<name> attribute node.
func DataAttr(name string, value string) Node { return Attr("data-"+name, value) }

// If returns n when cond is true, nil otherwise.
// The nil return is handled gracefully by El and Group.
func If(cond bool, n Node) Node {
	if cond {
		return n
	}
	return nil
}

// Map applies f to each item in items and returns the results as a Group.
func Map[T any](items []T, f func(T) Node) Group {
	out := Group{}
	for _, item := range items {
		out = append(out, f(item))
	}
	return out
}

// Style creates a <style> element containing the given CSS and mounts it into the parent.
// Use with MountTo("head") to inject scoped or global styles through the gom node system.
func Style(css string) Node {
	return NodeFunc(func(parent any) {
		el := document.createElement("style")
		el.textContent = css
		parent.appendChild(el)
	})
}

// MountTo appends a node into the element matching selector without clearing it first.
// Used for mounting styles into <head> or appending a component alongside existing content.
func MountTo(selector string, n Node) {
	el := document.querySelector(selector)
	n.Mount(el)
}

// Mount replaces the children of the element matching selector with the rendered node tree.
func Mount(selector string, n Node) {
	el := document.querySelector(selector)
	el.innerHTML = ""
	n.Mount(el)
}
