var __append = __append || function(a, ...b) { return a ? [...a, ...b] : b; };
var __s = __s || function(a) { return a || []; };

// interface Node (compile-time only)

class NodeFunc {
  constructor(_fn = null) { this._fn = _fn; }

  Mount(parent) {
    const n = this._fn;
    n(parent);
  }
}

class Group {
  constructor(_items = []) { this._items = _items; }

  Mount(parent) {
    const g = this._items;
    for (const [_$, n] of __s(g).entries()) {
      if (n !== null) {
        n.Mount(parent);
      }
    }
  }
}

class attrNode {
  constructor({ name = "", value = "" } = {}) {
    this.name = name;
    this.value = value;
  }

  Mount(parent) {
    const a = this;
    parent.setAttribute(a.name, a.value);
  }
}

function Div(...children) {
  return El("div", ...children);
}

function Section(...children) {
  return El("section", ...children);
}

function Article(...children) {
  return El("article", ...children);
}

function Aside(...children) {
  return El("aside", ...children);
}

function Header(...children) {
  return El("header", ...children);
}

function Footer(...children) {
  return El("footer", ...children);
}

function Main(...children) {
  return El("main", ...children);
}

function Nav(...children) {
  return El("nav", ...children);
}

function Figure(...children) {
  return El("figure", ...children);
}

function H1(...children) {
  return El("h1", ...children);
}

function H2(...children) {
  return El("h2", ...children);
}

function H3(...children) {
  return El("h3", ...children);
}

function H4(...children) {
  return El("h4", ...children);
}

function H5(...children) {
  return El("h5", ...children);
}

function H6(...children) {
  return El("h6", ...children);
}

function Span(...children) {
  return El("span", ...children);
}

function A(...children) {
  return El("a", ...children);
}

function Strong(...children) {
  return El("strong", ...children);
}

function Em(...children) {
  return El("em", ...children);
}

function Code(...children) {
  return El("code", ...children);
}

function Pre(...children) {
  return El("pre", ...children);
}

function Small(...children) {
  return El("small", ...children);
}

function Mark(...children) {
  return El("mark", ...children);
}

function P(...children) {
  return El("p", ...children);
}

function Br() {
  return El("br");
}

function Hr() {
  return El("hr");
}

function Ul(...children) {
  return El("ul", ...children);
}

function Ol(...children) {
  return El("ol", ...children);
}

function Li(...children) {
  return El("li", ...children);
}

function Dl(...children) {
  return El("dl", ...children);
}

function Dt(...children) {
  return El("dt", ...children);
}

function Dd(...children) {
  return El("dd", ...children);
}

function Form(...children) {
  return El("form", ...children);
}

function Input(...children) {
  return El("input", ...children);
}

function Button(...children) {
  return El("button", ...children);
}

function Textarea(...children) {
  return El("textarea", ...children);
}

function Select(...children) {
  return El("select", ...children);
}

function Option(...children) {
  return El("option", ...children);
}

function Label(...children) {
  return El("label", ...children);
}

function Fieldset(...children) {
  return El("fieldset", ...children);
}

function Legend(...children) {
  return El("legend", ...children);
}

function Img(...children) {
  return El("img", ...children);
}

function Video(...children) {
  return El("video", ...children);
}

function Audio(...children) {
  return El("audio", ...children);
}

function Canvas(...children) {
  return El("canvas", ...children);
}

function Table(...children) {
  return El("table", ...children);
}

function Thead(...children) {
  return El("thead", ...children);
}

function Tbody(...children) {
  return El("tbody", ...children);
}

function Tfoot(...children) {
  return El("tfoot", ...children);
}

function Tr(...children) {
  return El("tr", ...children);
}

function Th(...children) {
  return El("th", ...children);
}

function Td(...children) {
  return El("td", ...children);
}

function For(v) {
  return Attr("for", v);
}

function Name(v) {
  return Attr("name", v);
}

function Value(v) {
  return Attr("value", v);
}

function Target(v) {
  return Attr("target", v);
}

function Rel(v) {
  return Attr("rel", v);
}

function Alt(v) {
  return Attr("alt", v);
}

function Title(v) {
  return Attr("title", v);
}

function Lang(v) {
  return Attr("lang", v);
}

function Action(v) {
  return Attr("action", v);
}

function Method(v) {
  return Attr("method", v);
}

function AutoComplete(v) {
  return Attr("autocomplete", v);
}

function Draggable(v) {
  return Attr("draggable", v);
}

function Role(v) {
  return Attr("role", v);
}

function AriaLabel(v) {
  return Attr("aria-label", v);
}

function Disabled() {
  return Attr("disabled", "");
}

function Checked() {
  return Attr("checked", "");
}

function Selected() {
  return Attr("selected", "");
}

function Readonly() {
  return Attr("readonly", "");
}

function StyleAttr(v) {
  return Attr("style", v);
}

function El(tag, ...children) {
  return new NodeFunc(function(parent) {
    let el = document.createElement(tag);
    for (const [_$, c] of __s(children).entries()) {
      if (c !== null) {
        c.Mount(el);
      }
    }
    parent.appendChild(el);
  });
}

function Text(s) {
  return new NodeFunc(function(parent) {
    parent.appendChild(document.createTextNode(s));
  });
}

function Attr(name, value) {
  return new attrNode({ name: name, value: value });
}

function Class(v) {
  return Attr("class", v);
}

function ID(v) {
  return Attr("id", v);
}

function Href(v) {
  return Attr("href", v);
}

function Src(v) {
  return Attr("src", v);
}

function Type(v) {
  return Attr("type", v);
}

function Placeholder(v) {
  return Attr("placeholder", v);
}

function DataAttr(name, value) {
  return Attr("data-" + name, value);
}

function If(cond, n) {
  if (cond) {
    return n;
  }
  return null;
}

function Map(items, f) {
  let out = new Group([]);
  for (const [_$, item] of __s(items).entries()) {
    out = new Group(__append(out._items, f(item)));
  }
  return out;
}

function Style(css) {
  return new NodeFunc(function(parent) {
    let el = document.createElement("style");
    el.textContent = css;
    parent.appendChild(el);
  });
}

function MountTo(selector, n) {
  let el = document.querySelector(selector);
  n.Mount(el);
}

function Mount(selector, n) {
  let el = document.querySelector(selector);
  el.innerHTML = "";
  n.Mount(el);
}

var __append = __append || function(a, ...b) { return a ? [...a, ...b] : b; };
var __s = __s || function(a) { return a || []; };

function Plural(n, word) {
  if (n === 1) {
    return String(n) + " " + word;
  }
  return String(n) + " " + word + "s";
}

function HasText(s) {
  return s.trim() !== "";
}

function Filter(items, pred) {
  let out = null;
  for (const [_$, item] of __s(items).entries()) {
    if (pred(item)) {
      out = __append(out, item);
    }
  }
  return out;
}

var __len = __len || function(a) { if (a && typeof a === 'object' && !Array.isArray(a)) return Object.keys(a).length; return a?.length ?? 0; };
var __append = __append || function(a, ...b) { return a ? [...a, ...b] : b; };
var __s = __s || function(a) { return a || []; };
var __sprintf = __sprintf || function(f,...a){let i=0;return f.replace(/%([#+\- 0]*)([0-9]*)\.?([0-9]*)[sdvftxXqobeEgGw%]/g,(m)=>{if(m==='%%')return'%';const fl=m.slice(1,-1),verb=m.slice(-1),v=a[i++];const pad=(s,w,z)=>{w=parseInt(w)||0;if(!w)return s;const p=(z?'0':' ').repeat(Math.max(0,w-s.length));return fl.includes('-')?s+p:p+s;};const [,flags,width,prec]=m.match(/^%([#+\- 0]*)([0-9]*)\.?([0-9]*)/)||[];const zero=flags?.includes('0')&&!flags?.includes('-');switch(verb){case's':return pad(String(v==null?'<nil>':v),width,false);case'd':return pad(String(Math.trunc(Number(v))),width,zero);case'v':{if(typeof v==='object'&&v!==null&&'re' in v&&'im' in v){const sign=v.im>=0?'+':'';return pad('('+v.re+sign+v.im+'i)',width,false);}return pad(String(v==null?'<nil>':v),width,false);}case'f':{const n=Number(v),p=prec!==''?parseInt(prec):6;return pad(n.toFixed(p),width,zero);}case't':return pad(String(!!v),width,false);case'x':return pad((Number(v)>>>0).toString(16),width,zero);case'X':return pad((Number(v)>>>0).toString(16).toUpperCase(),width,zero);case'o':return pad((Number(v)>>>0).toString(8),width,zero);case'b':return pad((Number(v)>>>0).toString(2),width,zero);case'q':return pad('"'+String(v==null?'':v).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"',width,false);case'e':case'E':{const n=Number(v),p=prec!==''?parseInt(prec):6;return pad(n.toExponential(p),width,zero);}case'g':case'G':{const n=Number(v);return pad(prec!==''?n.toPrecision(parseInt(prec)):String(n),width,zero);}case'w':return pad(String(v==null?'<nil>':typeof v==='object'&&v.Error?v.Error():v),width,false);default:return m;}});};
var __error = __error || function(msg, cause) { return { Error() { return msg; }, toString() { return msg; }, _msg: msg, _cause: cause ?? null }; };

class Todo {
  constructor({ id = 0, text = "", done = false, priority = 0 } = {}) {
    this.id = id;
    this.text = text;
    this.done = done;
    this.priority = priority;
  }

  isUrgent() {
    const t = this;
    return t.priority === PriorityHigh && !t.done;
  }

  withDone(done) {
    const t = this;
    return new Todo({ id: t.id, text: t.text, done: done, priority: t.priority });
  }
}

let todos = [];

let nextId = 0;

let filter = 0;

let highPriority = false;

let dragSrcId = 0;

let dropAfter = false;

let syncMsg = "";

let syncCls = "";

let errorMsg = "";

const maxTodoLen = 120;

const FilterAll = 0;
const FilterActive = 1;
const FilterCompleted = 2;

const PriorityNormal = 0;
const PriorityHigh = 1;

async function submitInput() {
  let input = document.querySelector(".todo-input");
  let text = input.value.trim();
  let err = validateTodo(text);
  if (err !== null) {
    errorMsg = __sprintf("%v", err);
    render();
    await sleep(2500);
    errorMsg = "";
    render();
    document.querySelector(".todo-input").focus();
    return;
  }
  errorMsg = "";
  let priority = PriorityNormal;
  if (highPriority) {
    priority = PriorityHigh;
  }
  addTodo(text, priority);
  if (highPriority) {
    highPriority = false;
  }
  render();
  document.querySelector(".todo-input").focus();
  await triggerSave();
}

function setupEvents() {
  let app = document.querySelector("#app");
  app.addEventListener("click", function(e) {
    let action = e.target.getAttribute("data-action");
    if (action === null || action === "") {
      let btn = e.target.closest("[data-action]");
      if (btn === null) {
        return;
      }
      action = btn.getAttribute("data-action");
      e = { "target": btn };
    }
    switch (action) {
      case "add":
      {
        submitInput();
        break;
      }
      case "priority":
      {
        highPriority = !highPriority;
        render();
        break;
      }
      case "delete":
      {
        removeTodo(Math.trunc(Number(e.target.getAttribute("data-todo-id"))));
        render();
        triggerSave();
        break;
      }
      case "filter":
      {
        setFilter(Math.trunc(Number(e.target.getAttribute("data-filter"))));
        render();
        break;
      }
      case "clear-completed":
      {
        clearCompleted();
        render();
        triggerSave();
        break;
      }
      case "filter-active":
      {
        setFilter(FilterActive);
        render();
        break;
      }
    }
  });
  app.addEventListener("keydown", function(e) {
    if (e.target.matches(".todo-input") && e.key === "Enter") {
      submitInput();
    }
  });
  app.addEventListener("change", function(e) {
    if (e.target.getAttribute("data-action") === "toggle") {
      toggleTodo(Math.trunc(Number(e.target.getAttribute("data-todo-id"))));
      render();
      triggerSave();
    }
  });
  app.addEventListener("dragstart", function(e) {
    let li = e.target.closest("li");
    if (li === null) {
      return;
    }
    dragSrcId = Math.trunc(Number(li.getAttribute("data-id")));
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  app.addEventListener("dragover", function(e) {
    let li = e.target.closest("li");
    if (li === null) {
      return;
    }
    let targetId = Math.trunc(Number(li.getAttribute("data-id")));
    if (dragSrcId !== targetId) {
      e.preventDefault();
      let rect = li.getBoundingClientRect();
      dropAfter = e.clientY > rect.top + rect.height / 2;
      li.classList.remove("drag-over-top", "drag-over-bottom");
      if (dropAfter) {
        li.classList.add("drag-over-bottom");
      } else {
        li.classList.add("drag-over-top");
      }
    }
  });
  app.addEventListener("dragleave", function(e) {
    let li = e.target.closest("li");
    if (li === null) {
      return;
    }
    if (!li.contains(e.relatedTarget)) {
      li.classList.remove("drag-over-top", "drag-over-bottom");
    }
  });
  app.addEventListener("drop", function(e) {
    e.preventDefault();
    let li = e.target.closest("li");
    if (li === null) {
      return;
    }
    let targetId = Math.trunc(Number(li.getAttribute("data-id")));
    if (dragSrcId !== targetId) {
      moveTodo(dragSrcId, targetId, dropAfter);
      render();
      triggerSave();
    }
  });
  app.addEventListener("dragend", function(e) {
    let li = e.target.closest("li");
    if (li !== null) {
      li.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
    }
  });
}

async function main() {
  MountTo("head", Style(appStyles()));
  render();
  setupEvents();
  let loadErr = await loadTodos();
  if (loadErr !== null || __len(todos) === 0) {
    addTodo("Read the GoFront docs", PriorityNormal);
    addTodo("Fix the critical production bug", PriorityHigh);
    addTodo("Write tests", PriorityNormal);
    addTodo("Deploy to staging", PriorityHigh);
    addTodo("Send weekly update email", PriorityNormal);
    toggleTodo(0);
  }
  render();
  document.querySelector(".todo-input").focus();
}

function todoItemNode(t) {
  let cls = "todo-item";
  if (t.done) {
    cls = "todo-item done";
  } else if (t.isUrgent()) {
    cls = "todo-item high";
  }
  let id = String(t.id);
  return Li(Class(cls), Draggable("true"), DataAttr("id", id), Input(Type("checkbox"), Class("todo-cb"), DataAttr("action", "toggle"), DataAttr("todo-id", id), If(t.done, Checked())), Span(Class("todo-text"), Text(t.text)), If(t.isUrgent(), Span(Class("badge"), Text("urgent"))), Button(Class("del-btn"), DataAttr("action", "delete"), DataAttr("todo-id", id), Text("✕")));
}

function todoListNode() {
  let visible = visibleTodos();
  if (__len(visible) === 0) {
    return Ul(Class("todo-list"), Li(Class("empty"), Text("Nothing here.")));
  }
  return Ul(Class("todo-list"), Map(visible, todoItemNode));
}

function filterBarNode() {
  let fs = [FilterAll, FilterActive, FilterCompleted];
  return Div(Class("filter-bar"), Map(fs, function(f) {
    let cls = "filter-btn";
    if (f === filter) {
      cls = "filter-btn active";
    }
    return Button(Class(cls), DataAttr("action", "filter"), DataAttr("filter", String(f)), Text(filterLabel(f)));
  }));
}

function footerNode() {
  if (__len(todos) === 0) {
    return Footer(Class("footer"));
  }
  let [remaining, completed] = stats();
  let countText = Plural(remaining, "task") + " left";
  return Footer(Class("footer"), Span(Class("count"), Text(countText)), filterBarNode(), If(completed > 0, Button(Class("clear-btn"), DataAttr("action", "clear-completed"), Text("Clear (" + String(completed) + ")"))));
}

function badgeNode() {
  let hc = highCount();
  if (hc > 0) {
    return Span(Class("high-badge"), Text(String(hc) + " urgent"));
  }
  return Span(Class("high-badge"), StyleAttr("display:none"));
}

function syncStatusNode() {
  let cls = "sync-status";
  if (syncCls !== "") {
    cls = "sync-status " + syncCls;
  }
  return Span(Class(cls), Text(syncMsg));
}

function headerNode() {
  return Header(Class("header"), Div(Class("header-top"), Div(Class("header-icon"), Text("✓")), H1(Text("Todos Gom")), badgeNode(), syncStatusNode()), P(Class("tagline"), Text("Built with "), A(Href("https://github.com/seriva/gofront"), Target("_blank"), Strong(Text("GoFront"))), Text(" — Go compiled to JS")));
}

function inputRowNode() {
  let priorityCls = "priority-btn";
  let priorityText = "⚡ Normal";
  if (highPriority) {
    priorityCls = "priority-btn on";
    priorityText = "⚡ High";
  }
  let inputCls = "todo-input";
  if (highPriority) {
    inputCls = "todo-input high";
  }
  let placeholder = "What needs to be done?";
  if (highPriority) {
    placeholder = "What's urgent? (high priority)";
  }
  return Div(Class("input-row"), Input(Class(inputCls), Type("text"), Placeholder(placeholder), AutoComplete("off")), Button(Class(priorityCls), Type("button"), DataAttr("action", "priority"), Text(priorityText)), Button(Class("add-btn"), Type("button"), DataAttr("action", "add"), Text("Add")), If(highPriority, Span(Class("priority-hint"), Text("⚡ High priority — task will be marked urgent"))), If(errorMsg !== "", Span(Class("error-msg"), Text(errorMsg))));
}

function statsBarNode() {
  let n = __len(todos);
  let word = "todos";
  if (n === 1) {
    word = "todo";
  }
  return Div(Class("stats-bar"), Span(DataAttr("action", "filter-active"), Strong(Text(String(n))), Text(" " + word + " in session")));
}

function appView() {
  return Div(Class("card"), headerNode(), inputRowNode(), Div(Class("list-divider")), todoListNode(), footerNode(), statsBarNode());
}

function render() {
  Mount("#app", appView());
}

function validateTodo(text) {
  if (!HasText(text)) {
    return __error("todo text cannot be empty");
  }
  if (__len(Array.from(text, __c => __c.codePointAt(0))) > maxTodoLen) {
    return __error("todo text too long");
  }
  return null;
}

function safeJsonParse(raw) {
  let result = null;
  let err = null;
  const __defers = [];
  let __panic = null;
  try {
    __defers.push(() => { (function() {
      {
        let r = (typeof __panic !== "undefined" && __panic !== null ? (() => { const __r = __panic.message ?? String(__panic); __panic = null; return __r; })() : null);
        if (r !== null) {
          err = __error(__sprintf("%v", r));
        }
      }
    })(); });
    result = JSON.parse(raw);
    return [result, null];
  } catch (__err) {
    __panic = __err;
  } finally {
    for (let __i = __defers.length - 1; __i >= 0; __i--) __defers[__i]();
    if (__panic !== null) throw __panic;
  }
  return [result, err];
}

async function saveTodos() {
  localStorage.setItem("todos", JSON.stringify(todos));
  return null;
}

async function loadTodos() {
  let raw = localStorage.getItem("todos");
  if (raw === null) {
    return null;
  }
  let [parsed, parseErr] = safeJsonParse(raw);
  if (parseErr !== null || parsed === null) {
    return null;
  }
  let loaded = null;
  for (const [_$, item] of __s(parsed).entries()) {
    loaded = __append(loaded, new Todo({ id: item.id, text: item.text, done: item.done, priority: item.priority }));
  }
  if (__len(loaded) > 0) {
    let last = loaded[__len(loaded) - 1];
    nextId = last.id + 1;
  }
  todos = loaded;
  return null;
}

function setSyncStatus(msg, cls) {
  syncMsg = msg;
  syncCls = cls;
}

async function triggerSave() {
  setSyncStatus("Saving…", "saving");
  render();
  let err = await saveTodos();
  if (err !== null) {
    setSyncStatus("Save failed", "error");
    render();
    return;
  }
  setSyncStatus("Saved ✓", "saved");
  render();
  await sleep(1500);
  setSyncStatus("", "");
  render();
}

function addTodo(text, priority) {
  todos = __append(todos, new Todo({ id: nextId, text: text, done: false, priority: priority }));
  nextId++;
}

function toggleTodo(id) {
  let next = null;
  for (const [_$, t] of __s(todos).entries()) {
    if (t.id === id) {
      next = __append(next, t.withDone(!t.done));
    } else {
      next = __append(next, t);
    }
  }
  todos = next;
}

function removeTodo(id) {
  todos = Filter(todos, function(t) {
    return t.id !== id;
  });
}

function clearCompleted() {
  todos = Filter(todos, function(t) {
    return !t.done;
  });
}

function setFilter(f) {
  filter = f;
}

function moveTodo(fromId, toId, after) {
  if (fromId === toId) {
    return;
  }
  let item = new Todo();
  let rest = null;
  for (const [_$, t] of __s(todos).entries()) {
    if (t.id === fromId) {
      item = t;
    } else {
      rest = __append(rest, t);
    }
  }
  let result = null;
  let inserted = false;
  for (const [_$, t] of __s(rest).entries()) {
    if (!after && t.id === toId) {
      result = __append(result, item);
      inserted = true;
    }
    result = __append(result, t);
    if (after && t.id === toId) {
      result = __append(result, item);
      inserted = true;
    }
  }
  if (!inserted) {
    result = __append(result, item);
  }
  todos = result;
}

function visibleTodos() {
  switch (filter) {
    case FilterActive:
    {
      return Filter(todos, function(t) {
        return !t.done;
      });
    }
    case FilterCompleted:
    {
      return Filter(todos, function(t) {
        return t.done;
      });
    }
    default:
    {
      return __append([], ...todos);
    }
  }
}

function stats() {
  let remaining = 0;
  let completed = 0;
  for (const [_$, t] of __s(todos).entries()) {
    if (t.done) {
      completed++;
    } else {
      remaining++;
    }
  }
  return [remaining, completed];
}

function highCount() {
  return __len(Filter(todos, function(t) {
    return t.isUrgent();
  }));
}

function appStyles() {
  return "\n*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n\n:root {\n  --accent:      #a78bfc;\n  --accent-2:    #818cf8;\n  --accent-glow: rgba(167,139,250,.18);\n  --red:         #f87171;\n  --red-glow:    rgba(248,113,113,.15);\n  --green:       #6ee7b7;\n  --text:        #f8fafc;\n  --text-2:      #94a3b8;\n  --muted:       #3f4f63;\n  --surface:     rgba(15,23,42,.7);\n  --surface-2:   rgba(30,41,59,.6);\n  --surface-3:   rgba(51,65,85,.5);\n  --rim:         rgba(255,255,255,.07);\n  --radius:      20px;\n}\n\nbody {\n  font-family: \"Inter\", -apple-system, sans-serif;\n  min-height: 100vh;\n  display: flex;\n  align-items: flex-start;\n  justify-content: center;\n  padding: 72px 16px 96px;\n  background: #060912;\n  overflow-x: hidden;\n}\n\nbody::before {\n  content: '';\n  position: fixed;\n  inset: 0;\n  background:\n    radial-gradient(ellipse 60% 50% at 20% 10%, rgba(139,92,246,.22) 0%, transparent 60%),\n    radial-gradient(ellipse 50% 60% at 80% 80%, rgba(99,102,241,.18) 0%, transparent 60%),\n    radial-gradient(ellipse 40% 40% at 60% 30%, rgba(236,72,153,.1) 0%, transparent 50%);\n  pointer-events: none;\n  z-index: 0;\n}\n\n.card {\n  position: relative;\n  z-index: 1;\n  width: 100%;\n  max-width: 480px;\n  background: var(--surface);\n  backdrop-filter: blur(24px) saturate(1.6);\n  -webkit-backdrop-filter: blur(24px) saturate(1.6);\n  border-radius: var(--radius);\n  border: 1px solid var(--rim);\n  box-shadow:\n    0 0 0 1px rgba(255,255,255,.04) inset,\n    0 2px 4px rgba(0,0,0,.4),\n    0 20px 60px rgba(0,0,0,.6),\n    0 0 120px rgba(139,92,246,.06);\n  overflow: hidden;\n}\n\n.header {\n  padding: 32px 28px 24px;\n  position: relative;\n}\n\n.header::after {\n  content: '';\n  position: absolute;\n  bottom: 0; left: 0; right: 0;\n  height: 1px;\n  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);\n}\n\n.header-top {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  margin-bottom: 6px;\n}\n\n.header-icon {\n  width: 36px; height: 36px;\n  background: linear-gradient(135deg, #7c3aed, #a78bfa);\n  border-radius: 10px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 1rem;\n  box-shadow: 0 4px 14px rgba(124,58,237,.4);\n  flex-shrink: 0;\n}\n\nh1 {\n  font-size: 1.5rem;\n  font-weight: 700;\n  color: var(--text);\n  letter-spacing: -.04em;\n}\n\n.high-badge {\n  font-size: .6rem;\n  font-weight: 700;\n  background: linear-gradient(135deg, #ef4444, #f87171);\n  color: #fff;\n  padding: 3px 9px;\n  border-radius: 99px;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  box-shadow: 0 2px 10px rgba(239,68,68,.5);\n  animation: pop .25s cubic-bezier(.34,1.56,.64,1);\n}\n\n@keyframes pop {\n  from { transform: scale(0.5) rotate(-8deg); opacity: 0; }\n  to   { transform: scale(1) rotate(0deg);    opacity: 1; }\n}\n\n.tagline {\n  font-size: .73rem;\n  color: var(--muted);\n  letter-spacing: .01em;\n  padding-left: 48px;\n}\n.tagline strong { color: var(--accent); font-weight: 500; }\n.tagline a { color: inherit; text-decoration: none; }\n.tagline a:hover { text-decoration: underline; }\n\n.input-row {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  padding: 20px 20px 16px;\n}\n\n.todo-input {\n  flex: 1;\n  min-width: 0;\n  padding: 11px 16px;\n  border: 1px solid rgba(255,255,255,.08);\n  border-radius: 12px;\n  font-size: .9rem;\n  font-family: inherit;\n  outline: none;\n  background: var(--surface-2);\n  color: var(--text);\n  transition: border-color .2s, box-shadow .2s, background .2s;\n}\n.todo-input::placeholder { color: var(--muted); }\n.todo-input:focus {\n  border-color: rgba(167,139,250,.5);\n  background: var(--surface-3);\n  box-shadow: 0 0 0 3px var(--accent-glow), 0 1px 3px rgba(0,0,0,.3);\n}\n.todo-input.high {\n  border-color: rgba(248,113,113,.4);\n}\n.todo-input.high:focus {\n  border-color: rgba(248,113,113,.6);\n  box-shadow: 0 0 0 3px var(--red-glow), 0 1px 3px rgba(0,0,0,.3);\n}\n\n.add-btn {\n  padding: 11px 20px;\n  background: linear-gradient(135deg, #7c3aed, #a78bfa);\n  color: #fff;\n  border: none;\n  border-radius: 12px;\n  font-size: .9rem;\n  font-family: inherit;\n  font-weight: 600;\n  cursor: pointer;\n  transition: opacity .15s, box-shadow .2s, transform .1s;\n  white-space: nowrap;\n  box-shadow: 0 4px 14px rgba(124,58,237,.35);\n  letter-spacing: .01em;\n}\n.add-btn:hover  { opacity: .9; box-shadow: 0 6px 20px rgba(124,58,237,.5); }\n.add-btn:active { transform: scale(.96); opacity: 1; }\n\n.priority-btn {\n  padding: 11px 14px;\n  background: var(--surface-2);\n  color: var(--text-2);\n  border: 1px solid rgba(255,255,255,.08);\n  border-radius: 12px;\n  font-size: .82rem;\n  font-family: inherit;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all .2s;\n  white-space: nowrap;\n}\n.priority-btn:hover { border-color: rgba(255,255,255,.18); color: var(--text); }\n.priority-btn.on {\n  background: var(--red-glow);\n  color: var(--red);\n  border-color: rgba(248,113,113,.3);\n  box-shadow: 0 0 0 3px rgba(248,113,113,.07);\n}\n\n.priority-hint {\n  width: 100%;\n  font-size: .75rem;\n  color: var(--red);\n  opacity: .8;\n  padding: 0 4px;\n  letter-spacing: .01em;\n}\n\n.error-msg {\n  width: 100%;\n  font-size: .75rem;\n  color: var(--red);\n  background: var(--red-glow);\n  border-radius: 8px;\n  padding: 6px 12px;\n  letter-spacing: .01em;\n}\n\n.list-divider {\n  height: 1px;\n  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);\n  margin: 0 20px;\n}\n\n.todo-list {\n  list-style: none;\n  padding: 8px 0;\n  min-height: 60px;\n}\n\n.todo-item {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 12px 20px;\n  transition: background .15s;\n  cursor: default;\n  position: relative;\n}\n.todo-item::after {\n  content: '';\n  position: absolute;\n  bottom: 0; left: 20px; right: 20px;\n  height: 1px;\n  background: rgba(255,255,255,.04);\n}\n.todo-item:last-child::after { display: none; }\n.todo-item:hover { background: rgba(255,255,255,.03); }\n.todo-item[draggable=\"true\"] { cursor: grab; }\n.todo-item[draggable=\"true\"]:active { cursor: grabbing; }\n.todo-item.dragging { opacity: .35; }\n.todo-item.drag-over-top    { box-shadow: inset 0  2px 0 0 var(--accent); }\n.todo-item.drag-over-bottom { box-shadow: inset 0 -2px 0 0 var(--accent); }\n\n.todo-cb {\n  appearance: none;\n  -webkit-appearance: none;\n  width: 20px; height: 20px;\n  border: 1.5px solid rgba(255,255,255,.15);\n  border-radius: 7px;\n  cursor: pointer;\n  flex-shrink: 0;\n  position: relative;\n  transition: all .2s;\n  background: var(--surface-2);\n}\n.todo-cb:hover {\n  border-color: var(--accent);\n  box-shadow: 0 0 0 3px var(--accent-glow);\n}\n.todo-cb:checked {\n  background: linear-gradient(135deg, #7c3aed, #a78bfa);\n  border-color: transparent;\n  box-shadow: 0 2px 8px rgba(124,58,237,.4);\n}\n.todo-cb:checked::after {\n  content: '';\n  position: absolute;\n  left: 5px; top: 2px;\n  width: 6px; height: 10px;\n  border: 2px solid #fff;\n  border-top: none;\n  border-left: none;\n  transform: rotate(45deg);\n}\n\n.todo-text {\n  flex: 1;\n  font-size: .9rem;\n  color: var(--text);\n  line-height: 1.45;\n  transition: color .2s;\n  display: flex;\n  align-items: center;\n}\n.todo-item.done .todo-text {\n  text-decoration: line-through;\n  text-decoration-color: rgba(255,255,255,.2);\n  color: var(--muted);\n}\n\n.badge {\n  font-size: .58rem;\n  font-weight: 700;\n  background: linear-gradient(135deg, #ef4444, #f87171);\n  color: #fff;\n  padding: 2px 8px;\n  border-radius: 99px;\n  flex-shrink: 0;\n  letter-spacing: .08em;\n  text-transform: uppercase;\n  box-shadow: 0 2px 8px rgba(239,68,68,.35);\n}\n\n.del-btn {\n  background: none;\n  border: none;\n  color: transparent;\n  font-size: .8rem;\n  cursor: pointer;\n  padding: 5px 7px;\n  border-radius: 8px;\n  line-height: 1;\n  transition: color .15s, background .15s;\n  flex-shrink: 0;\n}\n.todo-item:hover .del-btn { color: var(--muted); }\n.del-btn:hover { color: var(--red); background: var(--red-glow); }\n\n.empty {\n  padding: 44px 24px;\n  color: var(--muted);\n  font-size: .85rem;\n  text-align: center;\n  list-style: none;\n  letter-spacing: .01em;\n}\n\nfooter.footer {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: 8px;\n  padding: 14px 20px;\n  position: relative;\n}\n\nfooter.footer::before {\n  content: '';\n  position: absolute;\n  top: 0; left: 0; right: 0;\n  height: 1px;\n  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);\n}\n\n.count {\n  font-size: .75rem;\n  color: var(--muted);\n  white-space: nowrap;\n  font-weight: 500;\n  letter-spacing: .01em;\n}\n\n.filter-bar { display: flex; gap: 2px; }\n\n.filter-btn {\n  padding: 5px 13px;\n  background: none;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  font-size: .75rem;\n  font-family: inherit;\n  font-weight: 500;\n  cursor: pointer;\n  color: var(--muted);\n  transition: all .15s;\n  letter-spacing: .01em;\n}\n.filter-btn:hover  { color: var(--text-2); background: var(--surface-2); }\n.filter-btn.active {\n  border-color: rgba(167,139,250,.3);\n  color: var(--accent);\n  font-weight: 600;\n  background: rgba(167,139,250,.08);\n}\n\n.clear-btn {\n  background: none;\n  border: none;\n  font-size: .75rem;\n  font-family: inherit;\n  color: var(--muted);\n  cursor: pointer;\n  padding: 5px 10px;\n  border-radius: 8px;\n  transition: color .15s, background .15s;\n  white-space: nowrap;\n  letter-spacing: .01em;\n}\n.clear-btn:hover { color: var(--red); background: var(--red-glow); }\n\n.sync-status {\n  font-size: .68rem;\n  font-weight: 600;\n  letter-spacing: .04em;\n  padding: 3px 10px;\n  border-radius: 99px;\n  opacity: 0;\n  transition: opacity .2s;\n}\n.sync-status.saving {\n  opacity: 1;\n  color: var(--text-2);\n  background: var(--surface-3);\n}\n.sync-status.saved {\n  opacity: 1;\n  color: var(--green);\n  background: rgba(110,231,183,.1);\n}\n.sync-status.error {\n  opacity: 1;\n  color: var(--red);\n  background: var(--red-glow);\n}\n\n.stats-bar {\n  text-align: center;\n  font-size: .65rem;\n  color: var(--muted);\n  padding: 6px 20px 14px;\n  letter-spacing: .04em;\n  opacity: .5;\n  border-top: 1px solid rgba(255,255,255,.04);\n}\n.stats-bar span { cursor: pointer; transition: color .15s; }\n.stats-bar span:hover { color: var(--accent); opacity: 1; }\n.stats-bar strong { font-weight: 600; color: var(--text-2); }\n";
}

function filterLabel(f) {
  switch (f) {
    case FilterAll:
    {
      return "All";
    }
    case FilterActive:
    {
      return "Active";
    }
    case FilterCompleted:
    {
      return "Completed";
    }
    default:
    {
      return "";
    }
  }
}

main();
