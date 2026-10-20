package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"./utils"
	"js:./preact.d.ts"
)

const maxTodoLen = 120

var (
	currentTodos []Todo
	nextId       int
	dragSrcId    int
	dropAfter    bool
	saveTimerSeq int
)

func validateTodo(text string) error {
	if !utils.HasText(text) {
		return errors.New("todo text cannot be empty")
	}
	if utf8.RuneCountInString(text) > maxTodoLen {
		return errors.New("todo text too long")
	}
	return nil
}

async func loadTodosFromStorage() []Todo {
	await sleep(200)
	raw := localStorage.getItem("todos")
	if raw == nil {
		return nil
	}
	var loaded []Todo
	err := json.Unmarshal([]byte(raw), &loaded)
	if err != nil {
		return nil
	}
	return loaded
}

func defaultTodos() []Todo {
	return []Todo{
		{ID: 1, Text: "Read the GoFront docs", Done: false, Priority: PriorityNormal},
		{ID: 2, Text: "Fix the critical production bug", Done: false, Priority: PriorityHigh},
		{ID: 3, Text: "Write tests", Done: true, Priority: PriorityNormal},
		{ID: 4, Text: "Deploy to staging", Done: false, Priority: PriorityHigh},
		{ID: 5, Text: "Send weekly update email", Done: false, Priority: PriorityNormal},
	}
}

async func saveToStorage(todosToSave []Todo, setSaving func(any), setSyncMsg func(any), setSyncCls func(any)) {
	saveTimerSeq++
	seq := saveTimerSeq

	setSaving(true)
	setSyncMsg("Saving…")
	setSyncCls("saving")

	await sleep(350)
	data, err := json.Marshal(todosToSave)
	if err == nil {
		localStorage.setItem("todos", string(data))
	}

	if seq != saveTimerSeq {
		return
	}

	setSaving(false)
	setSyncMsg("Saved ✓")
	setSyncCls("saved")

	await sleep(1500)
	if seq == saveTimerSeq {
		setSyncMsg("")
		setSyncCls("")
	}
}

func moveTodo(cur []Todo, fromId int, toId int, after bool) []Todo {
	if fromId == toId {
		return cur
	}
	var item Todo
	var rest []Todo
	for _, t := range cur {
		if t.ID == fromId {
			item = t
		} else {
			rest = append(rest, t)
		}
	}
	var result []Todo
	inserted := false
	for _, t := range rest {
		if !after && t.ID == toId {
			result = append(result, item)
			inserted = true
		}
		result = append(result, t)
		if after && t.ID == toId {
			result = append(result, item)
			inserted = true
		}
	}
	if !inserted {
		result = append(result, item)
	}
	return result
}

func App() VNode {
	todos, setTodos := useState([]Todo{})
	_ = todos
	loaded, setLoaded := useState(false)
	filter, setFilter := useState(FilterAll)
	highPriority, setHighPriority := useState(false)
	inputValue, setInputValue := useState("")
	errorMsg, setErrorMsg := useState("")
	syncMsg, setSyncMsg := useState("")
	syncCls, setSyncCls := useState("")
	saving, setSaving := useState(false)

	useEffect(func() {
		initLoad := async func() {
			loadedItems := await loadTodosFromStorage()
			if loadedItems != nil && len(loadedItems) > 0 {
				maxId := 0
				for _, t := range loadedItems {
					if t.ID > maxId {
						maxId = t.ID
					}
				}
				nextId = maxId + 1
				currentTodos = loadedItems
				setTodos(loadedItems)
			} else {
				defaults := defaultTodos()
				nextId = 6
				currentTodos = defaults
				setTodos(defaults)
			}
			setLoaded(true)
		}
		initLoad()
	}, []any{})

	if loaded != true {
		return h("div", map[string]any{"class": "loading-placeholder"},
			h("div", map[string]any{"style": "font-size: 2rem; opacity: .4"}, "✓"),
			h("span", nil, "Loading todos…"),
		)
	}

	doSave := func(newTodos []Todo) {
		currentTodos = newTodos
		setTodos(newTodos)
		saveToStorage(newTodos, setSaving, setSyncMsg, setSyncCls)
	}

	onToggle := func(id int) {
		var next []Todo
		for _, t := range currentTodos {
			if t.ID == id {
				next = append(next, t.withDone(!t.Done))
			} else {
				next = append(next, t)
			}
		}
		doSave(next)
	}

	onDelete := func(id int) {
		var next []Todo
		for _, t := range currentTodos {
			if t.ID != id {
				next = append(next, t)
			}
		}
		doSave(next)
	}

	onEdit := func(id int, text string) {
		trimmed := strings.TrimSpace(text)
		if trimmed == "" {
			onDelete(id)
			return
		}
		var next []Todo
		for _, t := range currentTodos {
			if t.ID == id {
				next = append(next, t.withText(trimmed))
			} else {
				next = append(next, t)
			}
		}
		doSave(next)
	}

	onAdd := func() {
		val := String(inputValue)
		err := validateTodo(val)
		if err != nil {
			setErrorMsg(err.Error())
			autoClear := async func() {
				await sleep(2500)
				setErrorMsg("")
			}
			autoClear()
			return
		}
		setErrorMsg("")

		prio := PriorityNormal
		if highPriority == true {
			prio = PriorityHigh
		}

		newTodo := Todo{
			ID:       nextId,
			Text:     val,
			Done:     false,
			Priority: prio,
		}
		nextId++

		next := append([]Todo{}, currentTodos...)
		next = append(next, newTodo)
		setInputValue("")
		if highPriority == true {
			setHighPriority(false)
		}
		doSave(next)
	}

	onTogglePriority := func() {
		if highPriority == true {
			setHighPriority(false)
		} else {
			setHighPriority(true)
		}
	}

	onFilter := func(f int) {
		setFilter(f)
	}

	onClearCompleted := func() {
		var next []Todo
		for _, t := range currentTodos {
			if !t.Done {
				next = append(next, t)
			}
		}
		doSave(next)
	}

	onDragStart := func(t Todo) func(any) {
		return func(e any) {
			dragSrcId = t.ID
			e.dataTransfer.effectAllowed = "move"
		}
	}

	onDragOver := func(t Todo) func(any) {
		return func(e any) {
			if dragSrcId != t.ID {
				e.preventDefault()
				rect := e.currentTarget.getBoundingClientRect()
				dropAfter = e.clientY > rect.top+rect.height/2
			}
		}
	}

	onDrop := func(t Todo) func(any) {
		return func(e any) {
			e.preventDefault()
			if dragSrcId != 0 && dragSrcId != t.ID {
				next := moveTodo(currentTodos, dragSrcId, t.ID, dropAfter)
				dragSrcId = 0
				doSave(next)
			}
		}
	}

	onDragEnd := func(e any) {
		dragSrcId = 0
	}

	remaining := 0
	completed := 0
	urgent := 0
	for _, t := range currentTodos {
		if t.Done {
			completed++
		} else {
			remaining++
		}
		if t.isUrgent() {
			urgent++
		}
	}

	f := filter.(int)
	var visible []Todo
	for _, t := range currentTodos {
		if f == FilterActive && t.Done {
			continue
		}
		if f == FilterCompleted && !t.Done {
			continue
		}
		visible = append(visible, t)
	}

	var itemElements []any
	if len(visible) == 0 {
		itemElements = append(itemElements, h("li", map[string]any{"class": "empty"}, "Nothing here."))
	} else {
		for _, t := range visible {
			itemElements = append(itemElements, h(TodoItem, TodoItemProps{
				Todo:        t,
				OnToggle:    onToggle,
				OnDelete:    onDelete,
				OnEdit:      onEdit,
				OnDragStart: onDragStart(t),
				OnDragOver:  onDragOver(t),
				OnDrop:      onDrop(t),
				OnDragEnd:   onDragEnd,
			}))
		}
	}

	return h("div", map[string]any{"class": "card"},
		h(Header, HeaderProps{
			UrgentCount: urgent,
			SyncMsg:     String(syncMsg),
			SyncCls:     String(syncCls),
		}),
		h(InputRow, InputRowProps{
			Value:            String(inputValue),
			HighPriority:     highPriority == true,
			Saving:           saving == true,
			ErrorMsg:         String(errorMsg),
			OnInput:          func(e any) { setInputValue(e.target.value) },
			OnKeyDown: func(e any) {
				if e.key == "Enter" {
					onAdd()
				}
			},
			OnTogglePriority: onTogglePriority,
			OnAdd:            onAdd,
		}),
		h("div", map[string]any{"class": "list-divider"}),
		h("ul", map[string]any{"class": "todo-list"}, itemElements...),
		h(Footer, FooterProps{
			Total:            len(currentTodos),
			Remaining:        remaining,
			Completed:        completed,
			Filter:           f,
			OnFilter:         onFilter,
			OnClearCompleted: onClearCompleted,
		}),
		h(StatsBar, StatsBarProps{
			Total: len(currentTodos),
			OnClick: func() {
				onFilter(FilterActive)
			},
		}),
	)
}

func main() {
	appEl := document.getElementById("app")
	render(h(App, nil), appEl)
}
