package main

import "js:./browser.d.ts"

// ── Input handling ────────────────────────────────────────────

async func submitInput() {
	input := document.querySelector(".todo-input")
	text := strings.TrimSpace(input.value)

	err := validateTodo(text)
	if err != nil {
		errorMsg = fmt.Sprintf("%v", err)
		render()
		await sleep(2500)
		errorMsg = ""
		render()
		document.querySelector(".todo-input").focus()
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
	document.querySelector(".todo-input").focus()
	await triggerSave()
}

// ── Events (attached once to #app; survive re-renders) ────────

func setupEvents() {
	app := document.querySelector("#app")

	// click — handles add, priority toggle, delete, filter, clear-completed, stats bar
	app.addEventListener("click", func(e any) {
		action := e.target.getAttribute("data-action")
		if action == nil || action == "" {
			btn := e.target.closest("[data-action]")
			if btn == nil {
				return
			}
			action = btn.getAttribute("data-action")
			e = map[string]any{"target": btn}
		}
		switch action {
		case "add":
			submitInput()
		case "priority":
			highPriority = !highPriority
			render()
		case "delete":
			removeTodo(int(e.target.getAttribute("data-todo-id")))
			render()
			triggerSave()
		case "filter":
			setFilter(int(e.target.getAttribute("data-filter")))
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
	app.addEventListener("keydown", func(e any) {
		if e.target.matches(".todo-input") && e.key == "Enter" {
			submitInput()
		}
	})

	// change — checkbox toggle
	app.addEventListener("change", func(e any) {
		if e.target.getAttribute("data-action") == "toggle" {
			toggleTodo(int(e.target.getAttribute("data-todo-id")))
			render()
			triggerSave()
		}
	})

	// drag-and-drop — delegated to #app so it survives re-renders
	app.addEventListener("dragstart", func(e any) {
		li := e.target.closest("li")
		if li == nil {
			return
		}
		dragSrcId = int(li.getAttribute("data-id"))
		li.classList.add("dragging")
		e.dataTransfer.effectAllowed = "move"
	})

	app.addEventListener("dragover", func(e any) {
		li := e.target.closest("li")
		if li == nil {
			return
		}
		targetId := int(li.getAttribute("data-id"))
		if dragSrcId != targetId {
			e.preventDefault()
			rect := li.getBoundingClientRect()
			dropAfter = e.clientY > rect.top+rect.height/2
			li.classList.remove("drag-over-top", "drag-over-bottom")
			if dropAfter {
				li.classList.add("drag-over-bottom")
			} else {
				li.classList.add("drag-over-top")
			}
		}
	})

	app.addEventListener("dragleave", func(e any) {
		li := e.target.closest("li")
		if li == nil {
			return
		}
		if !li.contains(e.relatedTarget) {
			li.classList.remove("drag-over-top", "drag-over-bottom")
		}
	})

	app.addEventListener("drop", func(e any) {
		e.preventDefault()
		li := e.target.closest("li")
		if li == nil {
			return
		}
		targetId := int(li.getAttribute("data-id"))
		if dragSrcId != targetId {
			moveTodo(dragSrcId, targetId, dropAfter)
			render()
			triggerSave()
		}
	})

	app.addEventListener("dragend", func(e any) {
		li := e.target.closest("li")
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
	document.querySelector(".todo-input").focus()
}
