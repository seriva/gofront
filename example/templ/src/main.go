package main

import (
	"gofront/dom"
	"js:./browser.d.ts"
	"strconv"
	"strings"
)

// ── Input handling ────────────────────────────────────────────

// attrInt reads the integer attribute name of el, or 0 when it is missing.
func attrInt(el dom.Element, name string) int {
	n, _ := strconv.Atoi(el.getAttribute(name))
	return n
}

func focusInput() {
	if refs["input"] != nil {
		refs["input"].(dom.HTMLElement).focus()
	}
}

async func submitInput() {
	if refs["input"] == nil {
		return
	}
	input := refs["input"].(dom.HTMLInputElement)
	text := strings.TrimSpace(input.value)

	err := validateTodo(text)
	if err != nil {
		errorMsg = fmt.Sprintf("%v", err)
		render()
		await sleep(2500)
		errorMsg = ""
		render()
		focusInput()
		return
	}

	errorMsg = ""
	priority := PriorityNormal
	if highPriority {
		priority = PriorityHigh
	}
	addTodo(text, priority)
	if highPriority {
		highPriority = false
	}
	render()
	focusInput()
	await triggerSave()
}

// ── Events (attached once to #app; survive re-renders) ────────

func setupEvents() {
	app := document.querySelector("#app")

	// click — handles add, priority toggle, delete, filter, clear-completed, stats bar
	app.addEventListener("click", func(e dom.MouseEvent) {
		target := e.target.(dom.Element)
		action := target.getAttribute("data-action")
		if action == nil || action == "" {
			btn := target.closest("[data-action]")
			if btn == nil {
				return
			}
			action = btn.getAttribute("data-action")
			target = btn
		}
		switch action {
		case "add":
			submitInput()
		case "priority":
			highPriority = !highPriority
			render()
		case "delete":
			removeTodo(attrInt(target, "data-todo-id"))
			render()
			triggerSave()
		case "filter":
			setFilter(attrInt(target, "data-filter"))
			render()
		case "clear-completed":
			clearCompleted()
			render()
			triggerSave()
		case "filter-active":
			setFilter(FilterActive)
			render()
		}
	})

	// keydown — Enter in the input submits
	app.addEventListener("keydown", func(e dom.KeyboardEvent) {
		if e.target.(dom.Element).matches(".todo-input") && e.key == "Enter" {
			submitInput()
		}
	})

	// change — checkbox toggle
	app.addEventListener("change", func(e dom.Event) {
		target := e.target.(dom.Element)
		if target.getAttribute("data-action") == "toggle" {
			toggleTodo(attrInt(target, "data-todo-id"))
			render()
			triggerSave()
		}
	})

	// drag-and-drop — delegated to #app so it survives re-renders
	app.addEventListener("dragstart", func(e dom.DragEvent) {
		li := e.target.(dom.Element).closest("li")
		if li == nil {
			return
		}
		dragSrcId = attrInt(li, "data-id")
		li.classList.add("dragging")
		e.dataTransfer.effectAllowed = "move"
	})

	app.addEventListener("dragover", func(e dom.DragEvent) {
		li := e.target.(dom.Element).closest("li")
		if li == nil {
			return
		}
		targetId := attrInt(li, "data-id")
		if dragSrcId != targetId {
			e.preventDefault()
			rect := li.getBoundingClientRect()
			dropAfter = float64(e.clientY) > rect.top+rect.height/2
			li.classList.remove("drag-over-top", "drag-over-bottom")
			if dropAfter {
				li.classList.add("drag-over-bottom")
			} else {
				li.classList.add("drag-over-top")
			}
		}
	})

	app.addEventListener("dragleave", func(e dom.DragEvent) {
		li := e.target.(dom.Element).closest("li")
		if li == nil {
			return
		}
		if !li.contains(e.relatedTarget.(dom.Node)) {
			li.classList.remove("drag-over-top", "drag-over-bottom")
		}
	})

	app.addEventListener("drop", func(e dom.DragEvent) {
		e.preventDefault()
		li := e.target.(dom.Element).closest("li")
		if li == nil {
			return
		}
		targetId := attrInt(li, "data-id")
		if dragSrcId != targetId {
			moveTodo(dragSrcId, targetId, dropAfter)
			render()
			triggerSave()
		}
	})

	app.addEventListener("dragend", func(e dom.DragEvent) {
		li := e.target.(dom.Element).closest("li")
		if li != nil {
			li.classList.remove("dragging", "drag-over-top", "drag-over-bottom")
		}
	})
}

// ── Entry point ───────────────────────────────────────────────

async func main() {
	gom.MountTo("head", AppStyles())
	render()       // initial render so #app has children before setupEvents
	setupEvents()  // attach all listeners once to #app

	loadErr := await loadTodos()
	if loadErr != nil || len(todos) == 0 {
		addTodo("Read the GoFront docs",          PriorityNormal)
		addTodo("Fix the critical production bug", PriorityHigh)
		addTodo("Write tests",                     PriorityNormal)
		addTodo("Deploy to staging",               PriorityHigh)
		addTodo("Send weekly update email",        PriorityNormal)
		toggleTodo(0)
	}

	render()
	focusInput()
}
