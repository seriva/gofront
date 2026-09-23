package main

import (
	"strings"
	"testing"
)

func TestRenderTodo(t *testing.T) {
	t.Run("normal active todo", func(t *testing.T) {
		td := Todo{id: 42, text: "Buy milk", done: false, priority: PriorityNormal}
		html := renderTodo(td)
		if !strings.Contains(html, `class="todo-item"`) {
			t.Errorf("expected class 'todo-item', got: %s", html)
		}
		if !strings.Contains(html, `data-id="42"`) {
			t.Errorf("expected data-id 42, got: %s", html)
		}
		if !strings.Contains(html, `Buy milk`) {
			t.Errorf("expected text 'Buy milk', got: %s", html)
		}
		if strings.Contains(html, `checked`) {
			t.Errorf("expected unchecked todo, got: %s", html)
		}
		if strings.Contains(html, `badge`) {
			t.Errorf("expected no badge for normal priority, got: %s", html)
		}
	})

	t.Run("high priority urgent todo", func(t *testing.T) {
		td := Todo{id: 7, text: "Fix bug", done: false, priority: PriorityHigh}
		html := renderTodo(td)
		if !strings.Contains(html, `todo-item high`) {
			t.Errorf("expected class 'todo-item high', got: %s", html)
		}
		if !strings.Contains(html, `<span class="badge">urgent</span>`) {
			t.Errorf("expected urgent badge, got: %s", html)
		}
	})

	t.Run("completed todo", func(t *testing.T) {
		td := Todo{id: 9, text: "Done item", done: true, priority: PriorityHigh}
		html := renderTodo(td)
		if !strings.Contains(html, `todo-item done`) {
			t.Errorf("expected class 'todo-item done', got: %s", html)
		}
		if !strings.Contains(html, `checked`) {
			t.Errorf("expected checked attribute, got: %s", html)
		}
		if strings.Contains(html, `badge`) {
			t.Errorf("expected no urgent badge for completed item, got: %s", html)
		}
	})

	t.Run("escapes html text", func(t *testing.T) {
		td := Todo{id: 1, text: `<script>alert("xss")</script>`, done: false, priority: PriorityNormal}
		html := renderTodo(td)
		if strings.Contains(html, `<script>`) {
			t.Errorf("expected HTML escaping of script tag, got: %s", html)
		}
		if !strings.Contains(html, `&lt;script&gt;`) {
			t.Errorf("expected &lt;script&gt;, got: %s", html)
		}
	})
}

func TestRenderFilterBar(t *testing.T) {
	filter = FilterActive
	html := renderFilterBar()
	if !strings.Contains(html, `filter-bar`) {
		t.Errorf("expected filter-bar container, got: %s", html)
	}
	if !strings.Contains(html, `data-filter="1"`) {
		t.Errorf("expected data-filter for FilterActive, got: %s", html)
	}
}

func TestRenderDOM(t *testing.T) {
	if document == nil {
		t.Skip("skipping DOM test in non-DOM environment")
	}
	document.body.innerHTML = `<div id="app">
		<ul class="todo-list"></ul>
		<footer class="footer"></footer>
		<span class="high-badge" style="display:none"></span>
	</div>`

	resetStore()
	addTodo("Test DOM Todo", PriorityNormal)
	render()

	list := document.querySelector(".todo-list")
	if list.children.length != 1 {
		t.Errorf("expected 1 child in todo-list, got %d", list.children.length)
	}

	footer := document.querySelector(".footer")
	if !strings.Contains(footer.innerHTML, "1 task left") {
		t.Errorf("expected '1 task left' in footer, got: %s", footer.innerHTML)
	}
}

