var __append = __append || function(a, ...b) {
  if (a && ArrayBuffer.isView(a)) {
    const res = new a.constructor(a.length + b.length);
    res.set(a);
    res.set(b, a.length);
    return res;
  }
  return a ? [...a, ...b] : b;
};

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
  for (let __i0 = 0, __arr0 = items, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
    let item = __arr0[__i0];
    if (pred(item)) {
      out = __append(out, item);
    }
  }
  return out;
}

var __len = __len || function(a) {
  if (a && typeof a === 'object' && !Array.isArray(a) && !ArrayBuffer.isView(a)) return Object.keys(a).length;
  return a?.length ?? 0;
};
var __append = __append || function(a, ...b) {
  if (a && ArrayBuffer.isView(a)) {
    const res = new a.constructor(a.length + b.length);
    res.set(a);
    res.set(b, a.length);
    return res;
  }
  return a ? [...a, ...b] : b;
};
var __ifv = __ifv || function(x, ptrFields) {
  if (x === null || typeof x !== "object") return x;
  const c = typeof x.__clone === "function" ? x.__clone() : Object.assign(Object.create(Object.getPrototypeOf(x)), x);
  Object.defineProperty(c, "__v", { value: true, configurable: true });
  if (Array.isArray(ptrFields)) {
    for (const f of ptrFields) {
      if (f.indexOf(".") !== -1) {
        const parts = f.split(".");
        let cur = c;
        for (let j = 0; j < parts.length - 1; j++) cur = cur?.[parts[j]];
        const last = parts[parts.length - 1];
        if (cur?.[last] !== null && typeof cur?.[last] === "object") __ifp(cur[last]);
      } else if (c[f] !== null && typeof c[f] === "object") {
        __ifp(c[f]);
      }
    }
  }
  for (const k of Object.keys(c)) {
    if (c[k] !== null && typeof c[k] === "object" && !Array.isArray(c[k]) && !ArrayBuffer.isView(c[k])) {
      if (!c[k].__v && !c[k].__p && (!Array.isArray(ptrFields) || !ptrFields.includes(k))) {
        Object.defineProperty(c[k], "__v", { value: true, configurable: true });
      }
    }
  }
  return c;
};
var __ifp = __ifp || function(x, ptrFields, seen) {
  if (x === null || typeof x !== "object") return x;
  if (x.__p !== true && Object.isExtensible(x))
    Object.defineProperty(x, "__p", { value: true, configurable: true });
  if (Array.isArray(ptrFields)) {
    seen = seen || new Set();
    if (seen.has(x)) return x;
    seen.add(x);
    for (const f of ptrFields) {
      if (f.indexOf(".") !== -1) {
        const parts = f.split(".");
        let cur = x;
        for (let j = 0; j < parts.length - 1; j++) cur = cur?.[parts[j]];
        const last = parts[parts.length - 1];
        if (cur?.[last] !== null && typeof cur?.[last] === "object") __ifp(cur[last]);
      } else if (x[f] !== null && typeof x[f] === "object") {
        __ifp(x[f]);
      }
    }
  }
  return x;
};
var __ifm = __ifm || function(x) {
  if (x === null || x === undefined) return x;
  if (typeof x !== "object") return x;
  if (x.__map !== true && Object.isExtensible(x))
    Object.defineProperty(x, "__map", { value: true, configurable: true });
  return x;
};
var __ifpm = __ifpm || function(x) {
  if (x === null || x === undefined) return x;
  if (typeof x !== "object") return x;
  if (x.__map !== true && Object.isExtensible(x)) {
    Object.defineProperty(x, "__map", { value: true, configurable: true });
    Object.defineProperty(x, "__ptr_map", { value: true, configurable: true });
  }
  return x;
};
var __ifs = __ifs || function(x, ptrFields) {
  if (x === null || x === undefined) return x;
  if (x.__slice !== true && Object.isExtensible(x))
    Object.defineProperty(x, "__slice", { value: true, configurable: true });
  if (Array.isArray(ptrFields) && Object.isExtensible(x))
    Object.defineProperty(x, "__ptr_fields", { value: ptrFields, configurable: true });
  return x;
};
var __ifps = __ifps || function(x) {
  if (x === null || x === undefined) return x;
  if (x.__slice !== true && Object.isExtensible(x)) {
    Object.defineProperty(x, "__slice", { value: true, configurable: true });
    Object.defineProperty(x, "__ptr_slice", { value: true, configurable: true });
  }
  return x;
};
var __gopanic = __gopanic || { stack: [], armed: false };
var __runDefers = __runDefers || function(defers, frame) {
  for (let i = defers.length - 1; i >= 0; i--) {
    __gopanic.armed = true;
    try { defers[i](); }
    catch (e) {
      if (frame.pn !== null) __gopanic.stack.pop();
      frame.pn = { err: e, recovered: false };
      __gopanic.stack.push(frame.pn);
    } finally { __gopanic.armed = false; }
  }
  if (frame.pn !== null) {
    __gopanic.stack.pop();
    if (!frame.pn.recovered) throw frame.pn.err;
  }
};
var __recover = __recover || function(ok) {
  if (!ok) return null;
  const s = __gopanic.stack;
  const top = s.length > 0 ? s[s.length - 1] : null;
  if (top === null || top.recovered) return null;
  top.recovered = true;
  return top.err?.message ?? String(top.err);
};
var __sprintf = __sprintf || function(f, ...a) {
  let i = 0;
  const ptrMap = new WeakMap();
  const ptrSet = new WeakSet();
  let ptrCounter = 1;
  const getPtr = (o) => {
    let p = ptrMap.get(o);
    if (!p) {
      p = "0x" + (ptrCounter++).toString(16);
      ptrMap.set(o, p);
    }
    return p;
  };
  const markPtr = (o) => {
    if (o !== null && typeof o === "object") ptrSet.add(o);
  };
  const isPointer = (o) => {
    return o !== null && typeof o === "object" && (o.__p === true || ptrSet.has(o));
  };
  const formatV = (val, isPlus, isTopLevel) => {
    if (val === null || val === undefined) return "<nil>";
    if (typeof val === "boolean") return String(val);
    if (typeof val === "number" || typeof val === "bigint") return String(val);
    if (typeof val === "string") return val;
    if (typeof val === "object") {
      if (val._d instanceof Date) {
        return typeof __timeFmt === "function" ? __timeFmt(val, "2006-01-02 15:04:05.999999999 -0700 MST") : String(val._d);
      }
      if ("re" in val && "im" in val) {
        const sign = val.im >= 0 ? "+" : "";
        return "(" + val.re + sign + val.im + "i)";
      }
      if (typeof val.Error === "function") {
        return String(val.Error());
      }
      if (Array.isArray(val) || ArrayBuffer.isView(val)) {
        const isElemPtr = val.__ptr_slice === true;
        const pf = val.__ptr_fields;
        const parts = [];
        for (let j = 0; j < val.length; j++) {
          const item = val[j];
          if (isElemPtr && item !== null && typeof item === "object") {
            markPtr(item);
          } else if (Array.isArray(pf) && item !== null && typeof item === "object") {
            for (const f of pf) {
              if (f.indexOf(".") !== -1) {
                const fparts = f.split(".");
                let cur = item;
                for (let k = 0; k < fparts.length - 1; k++) cur = cur?.[fparts[k]];
                const last = fparts[fparts.length - 1];
                if (cur?.[last] !== null && typeof cur?.[last] === "object") markPtr(cur[last]);
              } else if (item[f] !== null && typeof item[f] === "object") {
                markPtr(item[f]);
              }
            }
          }
          parts.push(formatV(item, isPlus, false));
        }
        return "[" + parts.join(" ") + "]";
      }
      if (val instanceof Map || val.__map === true) {
        const isElemPtr = val.__ptr_map === true;
        const parts = [];
        if (val instanceof Map) {
          const entries = Array.from(val.entries()).sort(([k1], [k2]) => {
            if (typeof k1 === "number" && typeof k2 === "number") return k1 - k2;
            const na = Number(k1), nb = Number(k2);
            if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
            return String(k1).localeCompare(String(k2));
          });
          for (const [k, v] of entries) {
            if (isElemPtr && v !== null && typeof v === "object") {
              markPtr(v);
            }
            parts.push(formatV(k, isPlus, false) + ":" + formatV(v, isPlus, false));
          }
        } else {
          const keys = Object.keys(val).sort((a, b) => {
            const na = Number(a), nb = Number(b);
            if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
            return a.localeCompare(b);
          });
          for (const k of keys) {
            const v = val[k];
            if (isElemPtr && v !== null && typeof v === "object") {
              markPtr(v);
            }
            parts.push(formatV(k, isPlus, false) + ":" + formatV(v, isPlus, false));
          }
        }
        return "map[" + parts.join(" ") + "]";
      }
      if ("value" in val && (val.__box === true || (!val.__struct && !("__v" in val) && Object.keys(val).length === 1 && (val.constructor === Object || !val.constructor || val.constructor?.name === "Object")))) {
        return getPtr(val);
      }
      const isPtr = isPointer(val);
      if (isPtr) {
        if (!isTopLevel) {
          return getPtr(val);
        }
        getPtr(val);
      }
      const prefix = isPtr ? "&{" : "{";
      const keys = Object.keys(val);
      const parts = [];
      for (const k of keys) {
        const fv = formatV(val[k], isPlus, false);
        parts.push(isPlus ? k + ":" + fv : fv);
      }
      return prefix + parts.join(" ") + "}";
    }
    return String(val);
  };
  return f.replace(/%([#+\- 0]*)([0-9]*)\.?([0-9]*)[sdvftxXqobeEgGwc%]/g, (m) => {
    if (m === "%%") return "%";
    const verb = m.slice(-1);
    const v = a[i++];
    const [, flags, width, prec] = m.match(/^%([#+\- 0]*)([0-9]*)\.?([0-9]*)/) || [];
    const zero = flags?.includes("0") && !flags?.includes("-");
    const pad = (s, w, z) => {
      w = parseInt(w) || 0;
      if (!w) return s;
      const p = (z ? "0" : " ").repeat(Math.max(0, w - s.length));
      return flags.includes("-") ? s + p : p + s;
    };
    switch (verb) {
      case "s": return pad(String(v == null ? "<nil>" : v), width, false);
      case "c": return pad(String.fromCodePoint(Number(v)), width, false);
      case "d": return pad(String(typeof v === "bigint" ? v : Math.trunc(Number(v))), width, zero);
      case "v": {
        const isPlus = flags?.includes("+") ?? false;
        return pad(formatV(v, isPlus, true), width, false);
      }
      case "f": { const n = Number(v), p = prec !== "" ? parseInt(prec) : 6; return pad(n.toFixed(p), width, zero); }
      case "t": return pad(String(!!v), width, false);
      case "x": {
        let hex;
        if (Array.isArray(v) || ArrayBuffer.isView(v)) {
          hex = Array.from(v).map((b) => (Number(b) & 0xff).toString(16).padStart(2, "0")).join("");
        } else if (typeof v === "string") {
          hex = Array.from(new TextEncoder().encode(v)).map((b) => b.toString(16).padStart(2, "0")).join("");
        } else if (typeof v === "bigint") {
          hex = BigInt.asUintN(64, v).toString(16);
        } else if (Math.abs(Number(v)) > 0xffffffff) {
          hex = (Math.trunc(Number(v) / 0x100000000) >>> 0).toString(16) + (Number(v) >>> 0).toString(16).padStart(8, "0");
        } else {
          hex = (Number(v) >>> 0).toString(16);
        }
        return pad(hex, width, zero);
      }
      case "X": {
        let hex;
        if (Array.isArray(v) || ArrayBuffer.isView(v)) {
          hex = Array.from(v).map((b) => (Number(b) & 0xff).toString(16).padStart(2, "0").toUpperCase()).join("");
        } else if (typeof v === "string") {
          hex = Array.from(new TextEncoder().encode(v)).map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
        } else if (typeof v === "bigint") {
          hex = BigInt.asUintN(64, v).toString(16).toUpperCase();
        } else if (Math.abs(Number(v)) > 0xffffffff) {
          hex = (Math.trunc(Number(v) / 0x100000000) >>> 0).toString(16).toUpperCase() + (Number(v) >>> 0).toString(16).padStart(8, "0").toUpperCase();
        } else {
          hex = (Number(v) >>> 0).toString(16).toUpperCase();
        }
        return pad(hex, width, zero);
      }
      case "o": return pad((typeof v === "bigint" ? BigInt.asUintN(64, v).toString(8) : (Number(v) >>> 0).toString(8)), width, zero);
      case "b": return pad((typeof v === "bigint" ? BigInt.asUintN(64, v).toString(2) : (Number(v) >>> 0).toString(2)), width, zero);
      case "q": return pad('"' + String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"', width, false);
      case "e": case "E": { const n = Number(v), p = prec !== "" ? parseInt(prec) : 6; return pad(n.toExponential(p), width, zero); }
      case "g": case "G": { const n = Number(v); return pad(prec !== "" ? n.toPrecision(parseInt(prec)) : String(n), width, zero); }
      case "w": return pad(String(v == null ? "<nil>" : typeof v === "object" && v.Error ? v.Error() : v), width, false);
      default: return m;
    }
  });
};
var __error = __error || function(msg, cause) {
  return { Error() { return msg; }, toString() { return msg; }, _msg: msg, _cause: cause ?? null };
};

class Todo {
  constructor(id$ = 0, text$ = "", done$ = false, priority$ = 0) {
    if (arguments.length === 1 && typeof id$ === "object" && id$ !== null && id$.constructor === Object) ({ id: id$ = 0, text: text$ = "", done: done$ = false, priority: priority$ = 0 } = id$);
    this.id = id$;
    this.text = text$;
    this.done = done$;
    this.priority = priority$;
  }

  isUrgent() {
    const t = this;
    return t.priority === PriorityHigh && !t.done;
  }

  withDone(done) {
    const t = this;
    return new Todo(t.id, t.text, done, t.priority);
  }

  __clone() { return new Todo(this.id, this.text, this.done, this.priority); }
}
Object.defineProperty(Todo.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });

class Stats {
  constructor(remaining$ = 0, completed$ = 0) {
    if (arguments.length === 1 && typeof remaining$ === "object" && remaining$ !== null && remaining$.constructor === Object) ({ remaining: remaining$ = 0, completed: completed$ = 0 } = remaining$);
    this.remaining = remaining$;
    this.completed = completed$;
  }

  __clone() { return new Stats(this.remaining, this.completed); }
}
Object.defineProperty(Stats.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });

class AppElements {
  constructor(input$ = null, addBtn$ = null, priorityBtn$ = null, list$ = null, footer$ = null, badge$ = null, syncStatus$ = null, inputRow$ = null, countSpan$ = null, filterArea$ = null) {
    this.input = input$;
    this.addBtn = addBtn$;
    this.priorityBtn = priorityBtn$;
    this.list = list$;
    this.footer = footer$;
    this.badge = badge$;
    this.syncStatus = syncStatus$;
    this.inputRow = inputRow$;
    this.countSpan = countSpan$;
    this.filterArea = filterArea$;
  }

  __clone() { return new AppElements(this.input, this.addBtn, this.priorityBtn, this.list, this.footer, this.badge, this.syncStatus, this.inputRow, this.countSpan, this.filterArea); }
}
Object.defineProperty(AppElements.prototype, "value", { get() { return this; }, set(v) { Object.assign(this, v); }, configurable: true });

const maxTodoLen = 120;

const FilterAll = 0;
const FilterActive = 1;
const FilterCompleted = 2;

const PriorityNormal = 0;
const PriorityHigh = 1;

let syncBaseClass = "";

let todosSignal = null;

let filterSignal = null;

let nextId = 0;

let highPriority = null;

let savingSignal = null;

let syncMsgSignal = null;

let syncClsSignal = null;

let loadStateSignal = null;

let loadedSignal = null;

let errorSignal = null;

let visibleSignal = null;

let statsSignal = null;

let highCountSignal = null;

function validateTodo(text) {
  if (!HasText(text)) {
    return __error("todo text cannot be empty");
  }
  if ([...(text)].length > maxTodoLen) {
    return __error("todo text too long");
  }
  return null;
}

async function submitInput(input, inputValue) {
  const __defers = [];
  const __frame = { pn: null };
  try {
    let __defrecv$1 = input;
    __defers.push(() => { (function() {
      const __recoverOk = __gopanic.armed; __gopanic.armed = false;
      __defrecv$1.focus();
    })(); });
    let err = validateTodo(inputValue.get());
    if (err != null) {
      errorSignal.set(err.Error());
      await sleep(2500);
      errorSignal.set("");
      return;
    }
    errorSignal.set("");
    let priority = PriorityNormal;
    if (highPriority.get()) {
      priority = PriorityHigh;
    }
    addTodo(inputValue.get(), priority);
    inputValue.set("");
    if (highPriority.get()) {
      highPriority.update(function(v) {
        return !v;
      });
    }
    await triggerSave();
  } catch (__err) {
    __frame.pn = { err: __err, recovered: false };
    __gopanic.stack.push(__frame.pn);
  } finally {
    __runDefers(__defers, __frame);
  }
}

function togglePriorityMode() {
  highPriority.update(function(v) {
    return !v;
  });
}

async function main() {
  if (window.location.search.includes("debug")) {
    setDebugMode(true);
  }
  let app = document.getElementById("app");
  let loadEl = document.createElement("div");
  loadEl.setAttribute("style", "display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:200px;color:var(--muted);font-size:.9rem;letter-spacing:.02em;gap:14px");
  app.appendChild(loadEl);
  Reactive.mount(loadEl, function() {
    return trusted("<div style=\"font-size:2rem;opacity:.4\">✓</div><span>Loading todos…</span>");
  });
  initStore();
  filterSignal.once(function(f) {
    console.log(__sprintf("[GoFront] Session started — initial filter: %d (0=All 1=Active 2=Done)", f));
  });
  let inputValue = Signals.create("", null, "inputValue");
  let unsub = null;
  unsub = loadStateSignal.subscribe(function(state) {
    if (state.status !== "resolved") {
      return;
    }
    if (unsub != null) {
      unsub();
    }
    let loaded = state.data;
    if (loaded != null && __len(loaded) > 0) {
      let last = loaded[__len(loaded) - 1];
      nextId = last.id + 1;
      todosSignal.set(loaded);
    } else {
      addTodo("Read the GoFront docs", PriorityNormal);
      addTodo("Fix the critical production bug", PriorityHigh);
      addTodo("Write tests", PriorityNormal);
      addTodo("Deploy to staging", PriorityHigh);
      addTodo("Send weekly update email", PriorityNormal);
      toggleTodo(0);
    }
    loadEl.remove();
    createAppShell(inputValue);
  });
}

function renderTodoHTML(t) {
  let cls = "todo-item";
  if (t.done) {
    cls = "todo-item done";
  } else if (t.isUrgent()) {
    cls = "todo-item high";
  }
  let checked = "";
  if (t.done) {
    checked = " checked";
  }
  let badge = "";
  if (t.isUrgent()) {
    badge = "<span class=\"badge\">urgent</span>";
  }
  let id = String(t.id);
  return trusted("<li class=\"" + cls + "\" draggable=\"true\" data-id=\"" + id + "\">\n<input type=\"checkbox\" class=\"todo-cb\" data-action=\"toggle\" data-todo-id=\"" + id + "\"" + checked + " />\n<span class=\"todo-text\">" + t.text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&#34;").replace(/'/g,"&#39;") + "</span>" + badge + "<button class=\"del-btn\" data-action=\"delete\" data-todo-id=\"" + id + "\">✕</button>\n</li>");
}

function renderFilterBarHTML(activeFilter) {
  let filters = [FilterAll, FilterActive, FilterCompleted];
  let b = { _buf: "" };
  ((__s) => { (b?.value ?? b)._buf += __s; return [new TextEncoder().encode(__s).length, null]; })("<div class=\"filter-bar\">");
  for (let __i0 = 0, __arr0 = filters, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
    let f = __arr0[__i0];
    let cls = "filter-btn";
    if (f === activeFilter) {
      cls = "filter-btn active";
    }
    ((__s) => { (b?.value ?? b)._buf += __s; return [new TextEncoder().encode(__s).length, null]; })("<button class=\"" + cls + "\" data-action=\"filter\" data-filter=\"" + String(f) + "\">");
    ((__s) => { (b?.value ?? b)._buf += __s; return [new TextEncoder().encode(__s).length, null]; })(filterLabel(f));
    ((__s) => { (b?.value ?? b)._buf += __s; return [new TextEncoder().encode(__s).length, null]; })("</button>");
  }
  ((__s) => { (b?.value ?? b)._buf += __s; return [new TextEncoder().encode(__s).length, null]; })("</div>");
  return trusted((b?.value ?? b)._buf);
}

function createAppShell(inputValue) {
  let comp = createReactiveComponent();
  let els = new AppElements();
  let hasError = Signals.computed(function() {
    return errorSignal.get() !== "";
  }, "hasError");
  let placeholder = Signals.computed(function() {
    if (highPriority.get()) {
      return "What's urgent? (high priority)";
    }
    return "What needs to be done?";
  }, "placeholder");
  comp.state = function() {
    return __ifm({ "inputValue": inputValue, "hasError": hasError, "errorMsg": errorSignal, "isHighPriority": highPriority, "showPriorityHint": highPriority, "placeholder": placeholder, "isSaving": savingSignal });
  };
  comp.onAdd = function(e) {
    submitInput(els.input, inputValue);
    return null;
  };
  comp.onKeydown = function(e) {
    if (e.key === "Enter") {
      submitInput(els.input, inputValue);
    }
    return null;
  };
  comp.onPriority = function(e) {
    togglePriorityMode();
    return null;
  };
  comp.template = function() {
    return trusted("<div class=\"card\" data-ref=\"card\">\n  <header class=\"header\" data-ref=\"header\">\n    <div class=\"header-top\">\n      <div class=\"header-icon\">✓</div>\n      <h1>Todos Reactive</h1>\n      <span class=\"high-badge\" data-ref=\"badge\"></span>\n      <span class=\"sync-status\" data-ref=\"syncStatus\"></span>\n    </div>\n    <p class=\"tagline\">Built with <a href=\"https://github.com/seriva/gofront\" target=\"_blank\"><strong>GoFront</strong></a> — Go compiled to JS</p>\n  </header>\n  <div class=\"input-row\" data-ref=\"inputRow\">\n    <input class=\"todo-input\" type=\"text\" autocomplete=\"off\"\n           data-ref=\"input\"\n           data-model=\"inputValue\"    data-on-keydown=\"onKeydown\"\n           data-class-high=\"isHighPriority\"\n           data-attr-placeholder=\"placeholder\"\n           data-bool-disabled=\"isSaving\" />\n    <button type=\"button\" class=\"priority-btn\" data-ref=\"priorityBtn\" data-on-click=\"onPriority\">⚡ Normal</button>\n    <button type=\"button\" class=\"add-btn\"      data-ref=\"addBtn\"      data-on-click=\"onAdd\">Add</button>\n    <span class=\"priority-hint\" data-visible=\"showPriorityHint\">⚡ High priority — task will be marked urgent</span>\n    <span class=\"error-msg\"     data-if=\"hasError\" data-text=\"errorMsg\"></span>\n  </div>\n  <div class=\"list-divider\"></div>\n  <ul class=\"todo-list\" data-ref=\"list\"></ul>\n  <footer class=\"footer\" data-ref=\"footer\">\n    <span class=\"count\"       data-ref=\"countSpan\"></span>\n    <div  class=\"filter-area\" data-ref=\"filterArea\"></div>\n  </footer>\n  <div id=\"stats-bar\"></div>\n</div>");
  };
  comp.mount = function() {
    comp.refs.card.classList.add(cardStyles());
    comp.refs.header.classList.add(headerStyles());
    comp.refs.inputRow.classList.add(inputRowStyles());
    comp.refs.list.classList.add(listStyles());
    comp.refs.footer.classList.add(footerStyles());
    syncBaseClass = syncStatusStyles();
    comp.refs.syncStatus.classList.add(syncBaseClass);
    els = new AppElements(comp.refs.input, comp.refs.addBtn, comp.refs.priorityBtn, comp.refs.list, comp.refs.footer, comp.refs.badge, comp.refs.syncStatus, comp.refs.inputRow, comp.refs.countSpan, comp.refs.filterArea);
    setupReactiveDOM(els);
    setupDragDrop(els);
  };
  comp.mountTo("app");
}

function setupReactiveDOM(els) {
  let ctx = Reactive.createComponent();
  let listView = ctx.computed(function() {
    let visible = visibleSignal.get();
    if (__len(visible) === 0) {
      return trusted("<li class=\"empty\">Nothing here.</li>");
    }
    let items = [];
    for (let i = 0; i < __len(visible); i++) {
      items = __append(items, renderTodoHTML(visible[i]));
    }
    return join(items, "");
  }, "listView");
  ctx.bind(els.list, listView, function(v) {
    return v;
  });
  let filterView = ctx.computed(function() {
    let f = filterSignal.get();
    let s = statsSignal.get();
    let clearBtn = "";
    if (s.completed > 0) {
      clearBtn = "<button class=\"clear-btn\" data-action=\"clear-completed\">Clear (" + String(s.completed) + ")</button>";
    }
    return trusted(renderFilterBarHTML(f).content + clearBtn);
  }, "filterView");
  ctx.bind(els.filterArea, filterView, function(v) {
    return v;
  });
  ctx.bindStyle(els.footer, "display", ctx.computed(function() {
    if (__len(todosSignal.get()) === 0) {
      return "none";
    }
    return "";
  }, "footerDisplay"));
  ctx.bindMultiple(els.countSpan, [todosSignal, statsSignal], function(vals) {
    if (__len(vals[0]) === 0) {
      return "";
    }
    let s = vals[1];
    return Plural(s.remaining, "task") + " left";
  });
  ctx.bindText(els.badge, ctx.computed(function() {
    let hc = highCountSignal.get();
    if (hc > 0) {
      return String(hc) + " urgent";
    }
    return "";
  }, "badgeText"));
  ctx.bindStyle(els.badge, "display", ctx.computed(function() {
    if (highCountSignal.get() > 0) {
      return "inline-block";
    }
    return "none";
  }, "badgeDisplay"));
  ctx.bindClass(els.priorityBtn, "on", highPriority);
  ctx.bindText(els.priorityBtn, ctx.computed(function() {
    if (highPriority.get()) {
      return "⚡ High";
    }
    return "⚡ Normal";
  }, "priorityLabel"));
  ctx.bindBoolAttr(els.addBtn, "disabled", savingSignal);
  ctx.bindStyle(els.addBtn, "background", ctx.computed(function() {
    if (highPriority.get()) {
      return "linear-gradient(135deg, #dc2626, #f87171)";
    }
    return "linear-gradient(135deg, #7c3aed, #a78bfa)";
  }, "addBtnBg"));
  ctx.bindAttr(els.addBtn, "aria-label", ctx.computed(function() {
    if (highPriority.get()) {
      return "Add urgent todo";
    }
    return "Add todo";
  }, "ariaLabel"));
  ctx.bindText(els.syncStatus, syncMsgSignal);
  ctx.bindAttr(els.syncStatus, "class", ctx.computed(function() {
    let cls = syncClsSignal.get();
    if (cls !== "") {
      return syncBaseClass + " " + cls;
    }
    return syncBaseClass;
  }, "syncClass"));
  els.list.addEventListener("change", function(e) {
    let action = e.target.getAttribute("data-action");
    if (action === "toggle") {
      let idStr = e.target.getAttribute("data-todo-id");
      toggleTodo(Math.trunc(Number(idStr)));
      triggerSave();
    }
  });
  els.list.addEventListener("click", function(e) {
    let action = e.target.getAttribute("data-action");
    if (action === "delete") {
      let idStr = e.target.getAttribute("data-todo-id");
      removeTodo(Math.trunc(Number(idStr)));
      triggerSave();
    }
  });
  els.filterArea.addEventListener("click", function(e) {
    let action = e.target.getAttribute("data-action");
    switch (action) {
      case "filter":
      {
        let f = Math.trunc(Number(e.target.getAttribute("data-filter")));
        setFilter(f);
        break;
      }
      case "clear-completed":
      {
        clearCompleted();
        triggerSave();
        break;
      }
    }
  });
  setupStatsBar();
}

function setupDragDrop(els) {
  let comp = createReactiveComponent();
  let dragSrcSig = comp.signal(0, "dragSrc");
  let dropAfterSig = comp.signal(false, "dropAfter");
  comp.effect(function() {
    let hc = highCountSignal.get();
    if (hc > 0) {
      document.title = __sprintf("(%d urgent) GoFront Todos", hc);
    } else {
      document.title = "GoFront Todos";
    }
  });
  comp.on(els.list, "dragstart", function(e) {
    let li = e.target.closest("li");
    if (li == null) {
      return;
    }
    dragSrcSig.set(Math.trunc(Number(li.getAttribute("data-id"))));
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  }, null);
  comp.on(els.list, "dragover", function(e) {
    let li = e.target.closest("li");
    if (li == null) {
      return;
    }
    let targetId = Math.trunc(Number(li.getAttribute("data-id")));
    if (dragSrcSig.peek() !== targetId) {
      e.preventDefault();
      let rect = li.getBoundingClientRect();
      let after = e.clientY > rect.top + rect.height / 2;
      dropAfterSig.set(after);
      li.classList.remove("drag-over-top", "drag-over-bottom");
      if (after) {
        li.classList.add("drag-over-bottom");
      } else {
        li.classList.add("drag-over-top");
      }
    }
  }, null);
  comp.on(els.list, "dragleave", function(e) {
    let li = e.target.closest("li");
    if (li == null) {
      return;
    }
    if (!li.contains(e.relatedTarget)) {
      li.classList.remove("drag-over-top", "drag-over-bottom");
    }
  }, null);
  comp.on(els.list, "drop", function(e) {
    e.preventDefault();
    let li = e.target.closest("li");
    if (li == null) {
      return;
    }
    let targetId = Math.trunc(Number(li.getAttribute("data-id")));
    let src = dragSrcSig.peek();
    if (src !== targetId) {
      moveTodo(src, targetId, dropAfterSig.peek());
      triggerSave();
    }
  }, null);
  comp.on(els.list, "dragend", function(e) {
    let li = e.target.closest("li");
    if (li != null) {
      li.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
    }
  }, null);
}

function setupStatsBar() {
  let comp = createReactiveComponent();
  comp.state = function() {
    return __ifm({ "todoCount": function() {
      let n = __len(todosSignal.get());
      return htmlTag(["<strong>", "</strong> in session"], Plural(n, "todo"));
    } });
  };
  comp.template = function() {
    return trusted("<div><span data-ref=\"counter\" data-html=\"todoCount\" title=\"Show active todos\"></span></div>");
  };
  comp.styles = function() {
    return cssClass("\n            text-align: center;\n            font-size: .65rem;\n            color: var(--muted);\n            padding: 6px 20px 14px;\n            letter-spacing: .04em;\n            opacity: .5;\n            border-top: 1px solid rgba(255,255,255,.04);\n            & span { cursor: pointer; transition: color .15s, opacity .15s; }\n            & span:hover { color: var(--accent); opacity: 1; }\n            & strong { font-weight: 600; color: var(--text-2); }\n        ");
  };
  comp.mount = function() {
    comp.on(comp.refs.counter, "click", function(e) {
      setFilter(FilterActive);
    }, null);
  };
  comp.appendTo("stats-bar");
}

function initStore() {
  todosSignal = Signals.create([], null, "todos");
  filterSignal = Signals.create(FilterAll, null, "filter");
  highPriority = Signals.create(false, null, "highPriority");
  savingSignal = Signals.create(false, null, "saving");
  syncMsgSignal = Signals.create("", null, "syncMsg");
  syncClsSignal = Signals.create("", null, "syncCls");
  loadedSignal = Signals.create(false, null, "loaded");
  errorSignal = Signals.create("", null, "error");
  loadStateSignal = Signals.computedAsync(asyncLoadFromStorage, "loadState");
  visibleSignal = Signals.computed(function() {
    let todos = todosSignal.get();
    let f = filterSignal.get();
    switch (f) {
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
  }, "visible");
  statsSignal = Signals.computed(function() {
    let remaining = 0;
    let completed = 0;
    for (let __i0 = 0, __arr0 = todosSignal.get(), __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
      let t = __arr0[__i0];
      if (t.done) {
        completed++;
      } else {
        remaining++;
      }
    }
    return __ifv(new Stats(remaining, completed));
  }, "stats");
  highCountSignal = Signals.computed(function() {
    let urgent = Filter(todosSignal.get(), function(t) {
      return t.isUrgent();
    });
    return __len(urgent);
  }, "highCount");
}

async function asyncLoadFromStorage(cancel) {
  await sleep(200);
  if (cancel.cancelled) {
    return null;
  }
  let raw = localStorage.getItem("todos");
  if (raw == null) {
    return null;
  }
  let [parsed, parseErr] = safeJsonParse(raw);
  if (parseErr != null || parsed == null) {
    return null;
  }
  let loaded = null;
  for (let __i0 = 0, __arr0 = parsed, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
    let item = __arr0[__i0];
    loaded = __append(loaded, new Todo(item.id, item.text, item.done, item.priority));
  }
  return loaded;
}

async function saveTodos() {
  savingSignal.set(true);
  await sleep(350);
  localStorage.setItem("todos", JSON.stringify(todosSignal.peek()));
  savingSignal.set(false);
  return null;
}

function safeJsonParse(raw) {
  let result = null;
  let err = null;
  const __defers = [];
  const __frame = { pn: null };
  try {
    __defers.push(() => { (function() {
      const __recoverOk = __gopanic.armed; __gopanic.armed = false;
      {
        let r = __recover(__recoverOk);
        if (r != null) {
          err = __error(__sprintf("%v", r));
        }
      }
    })(); });
    result = JSON.parse(raw);
    [result, err] = [result, null];
    return [result, err];
  } catch (__err) {
    __frame.pn = { err: __err, recovered: false };
    __gopanic.stack.push(__frame.pn);
  } finally {
    __runDefers(__defers, __frame);
    return [result, err];
  }
  return [result, err];
}

function setSyncStatus(msg, cls) {
  syncMsgSignal.set(msg);
  syncClsSignal.set(cls);
}

async function triggerSave() {
  setSyncStatus("Saving…", "saving");
  let err = await saveTodos();
  if (err != null) {
    setSyncStatus("Save failed", "error");
    return;
  }
  setSyncStatus("Saved ✓", "saved");
  await sleep(1500);
  setSyncStatus("", "");
}

function addTodo(text, priority) {
  Signals.batch(function() {
    let cur = todosSignal.get();
    todosSignal.set(__append(cur, new Todo(nextId, text, false, priority)));
    nextId++;
    return null;
  });
}

function toggleTodo(id) {
  todosSignal.update(function(cur) {
    let next = null;
    for (let __i0 = 0, __arr0 = cur, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
      let t = __arr0[__i0];
      if (t.id === id) {
        next = __append(next, t.withDone(!t.done));
      } else {
        next = __append(next, t);
      }
    }
    return next;
  });
}

function removeTodo(id) {
  let cur = __append([], ...todosSignal.get());
  todosSignal.set(((s, f) => { if (!s || s.length === 0) return s; let k = 0; for (let i = 0; i < s.length; i++) { if (!f(s[i])) s[k++] = s[i]; } return ArrayBuffer.isView(s) ? s.subarray(0, k) : (s.length = k, s); })(cur, function(t) {
    return t.id === id;
  }));
}

function clearCompleted() {
  let cur = __append([], ...todosSignal.get());
  todosSignal.set(((s, f) => { if (!s || s.length === 0) return s; let k = 0; for (let i = 0; i < s.length; i++) { if (!f(s[i])) s[k++] = s[i]; } return ArrayBuffer.isView(s) ? s.subarray(0, k) : (s.length = k, s); })(cur, function(t) {
    return t.done;
  }));
}

function setFilter(f) {
  filterSignal.set(f);
}

function moveTodo(fromId, toId, after) {
  if (fromId === toId) {
    return;
  }
  let cur = todosSignal.get();
  let item = new Todo();
  let rest = null;
  for (let __i0 = 0, __arr0 = cur, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
    let t = __arr0[__i0];
    if (t.id === fromId) {
      item = t;
    } else {
      rest = __append(rest, t);
    }
  }
  let result = null;
  let inserted = false;
  for (let __i0 = 0, __arr0 = rest, __len0 = __arr0 ? __arr0.length : 0; __i0 < __len0; __i0++) {
    let t = __arr0[__i0];
    if (!after && t.id === toId) {
      result = __append(result, item.__clone());
      inserted = true;
    }
    result = __append(result, t.__clone());
    if (after && t.id === toId) {
      result = __append(result, item.__clone());
      inserted = true;
    }
  }
  if (!inserted) {
    result = __append(result, item.__clone());
  }
  todosSignal.set(result);
}

function statusLine() {
  let s = statsSignal.get();
  return Plural(s.remaining, "task") + " left";
}

function cardStyles() {
  return cssClass("\n        position: relative;\n        z-index: 1;\n        width: 100%;\n        max-width: 480px;\n        background: var(--surface);\n        backdrop-filter: blur(24px) saturate(1.6);\n        -webkit-backdrop-filter: blur(24px) saturate(1.6);\n        border-radius: var(--radius);\n        border: 1px solid var(--rim);\n        box-shadow: 0 0 0 1px rgba(255,255,255,.04) inset, 0 2px 4px rgba(0,0,0,.4), 0 20px 60px rgba(0,0,0,.6), 0 0 120px rgba(139,92,246,.06);\n        overflow: hidden;\n        & .list-divider { height: 1px; background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent); margin: 0 20px; }\n    ");
}

function headerStyles() {
  return cssClass("\n        padding: 32px 28px 24px;\n        position: relative;\n        &::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent); }\n        & .header-top { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }\n        & .header-icon { width: 36px; height: 36px; background: linear-gradient(135deg, #7c3aed, #a78bfa); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1rem; box-shadow: 0 4px 14px rgba(124,58,237,.4); flex-shrink: 0; }\n        & h1 { font-size: 1.5rem; font-weight: 700; color: var(--text); letter-spacing: -.04em; }\n        & .high-badge { display: none; font-size: .6rem; font-weight: 700; background: linear-gradient(135deg, #ef4444, #f87171); color: #fff; padding: 3px 9px; border-radius: 99px; letter-spacing: .08em; text-transform: uppercase; box-shadow: 0 2px 10px rgba(239,68,68,.5); animation: pop .25s cubic-bezier(.34,1.56,.64,1); }\n        & .tagline { font-size: .73rem; color: var(--muted); letter-spacing: .01em; padding-left: 48px; }\n        & .tagline strong { color: var(--accent); font-weight: 500; }\n        & .tagline a { color: inherit; text-decoration: none; }\n        & .tagline a:hover { text-decoration: underline; }\n    ");
}

function inputRowStyles() {
  return cssClass("\n        display: flex;\n        gap: 8px;\n        padding: 20px 20px 16px;\n        flex-wrap: wrap;\n        & .todo-input { flex: 1; padding: 11px 16px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; font-size: .9rem; font-family: inherit; outline: none; background: var(--surface-2); color: var(--text); transition: border-color .2s, box-shadow .2s, background .2s; }\n        & .todo-input::placeholder { color: var(--muted); }\n        & .todo-input:focus { border-color: rgba(167,139,250,.5); background: var(--surface-3); box-shadow: 0 0 0 3px var(--accent-glow), 0 1px 3px rgba(0,0,0,.3); }\n        & .todo-input.high { border-color: rgba(248,113,113,.45); box-shadow: 0 0 0 3px rgba(248,113,113,.1); }\n        & .todo-input.high:focus { border-color: rgba(248,113,113,.7); box-shadow: 0 0 0 3px rgba(248,113,113,.18); }\n        & .priority-hint { display: none; flex-basis: 100%; order: 3; padding: 4px 4px 0; font-size: .75rem; color: var(--red); letter-spacing: .01em; font-weight: 500; }\n        & .error-msg { flex-basis: 100%; order: 4; padding: 4px 4px 0; font-size: .75rem; color: var(--red); letter-spacing: .01em; animation: pop .18s cubic-bezier(.34,1.56,.64,1); }\n        & .add-btn { padding: 11px 20px; background: linear-gradient(135deg, #7c3aed, #a78bfa); color: #fff; border: none; border-radius: 12px; font-size: .9rem; font-family: inherit; font-weight: 600; cursor: pointer; transition: opacity .15s, box-shadow .2s, transform .1s; white-space: nowrap; box-shadow: 0 4px 14px rgba(124,58,237,.35); letter-spacing: .01em; }\n        & .add-btn:hover { opacity: .9; box-shadow: 0 6px 20px rgba(124,58,237,.5); }\n        & .add-btn:active { transform: scale(.96); opacity: 1; }\n        & .add-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }\n        & .priority-btn { padding: 11px 14px; background: var(--surface-2); color: var(--text-2); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; font-size: .82rem; font-family: inherit; font-weight: 600; cursor: pointer; transition: all .2s; white-space: nowrap; }\n        & .priority-btn:hover { border-color: rgba(255,255,255,.18); color: var(--text); }\n        & .priority-btn.on { background: var(--red-glow); color: var(--red); border-color: rgba(248,113,113,.3); box-shadow: 0 0 0 3px rgba(248,113,113,.07); }\n    ");
}

function listStyles() {
  return cssClass("\n        list-style: none;\n        padding: 8px 0;\n        min-height: 60px;\n        & .todo-item { display: flex; align-items: center; gap: 12px; padding: 12px 20px; transition: background .15s; cursor: default; position: relative; }\n        & .todo-item::after { content: ''; position: absolute; bottom: 0; left: 20px; right: 20px; height: 1px; background: rgba(255,255,255,.04); }\n        & .todo-item:last-child::after { display: none; }\n        & .todo-item:hover { background: rgba(255,255,255,.03); }\n        & .todo-item[draggable=\"true\"] { cursor: grab; }\n        & .todo-item[draggable=\"true\"]:active { cursor: grabbing; }\n        & .todo-item.dragging { opacity: .35; }\n        & .todo-item.drag-over-top    { box-shadow: inset 0  2px 0 0 var(--accent); }\n        & .todo-item.drag-over-bottom { box-shadow: inset 0 -2px 0 0 var(--accent); }\n        & .todo-cb { appearance: none; -webkit-appearance: none; width: 20px; height: 20px; border: 1.5px solid rgba(255,255,255,.15); border-radius: 7px; cursor: pointer; flex-shrink: 0; position: relative; transition: all .2s; background: var(--surface-2); }\n        & .todo-cb:hover { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }\n        & .todo-cb:checked { background: linear-gradient(135deg, #7c3aed, #a78bfa); border-color: transparent; box-shadow: 0 2px 8px rgba(124,58,237,.4); }\n        & .todo-cb:checked::after { content: ''; position: absolute; left: 5px; top: 2px; width: 6px; height: 10px; border: 2px solid #fff; border-top: none; border-left: none; transform: rotate(45deg); }\n        & .todo-text { flex: 1; font-size: .9rem; color: var(--text); line-height: 1.45; transition: color .2s; display: flex; align-items: center; }\n        & .todo-item.done .todo-text { text-decoration: line-through; text-decoration-color: rgba(255,255,255,.2); color: var(--muted); }\n        & .badge { font-size: .58rem; font-weight: 700; background: linear-gradient(135deg, #ef4444, #f87171); color: #fff; padding: 2px 8px; border-radius: 99px; flex-shrink: 0; letter-spacing: .08em; text-transform: uppercase; box-shadow: 0 2px 8px rgba(239,68,68,.35); }\n        & .del-btn { background: none; border: none; color: transparent; font-size: .8rem; cursor: pointer; padding: 5px 7px; border-radius: 8px; line-height: 1; transition: color .15s, background .15s; flex-shrink: 0; }\n        & .todo-item:hover .del-btn { color: var(--muted); }\n        & .del-btn:hover { color: var(--red); background: var(--red-glow); }\n        & .empty { padding: 44px 24px; color: var(--muted); font-size: .85rem; text-align: center; list-style: none; letter-spacing: .01em; }\n    ");
}

function footerStyles() {
  return cssClass("\n        display: flex;\n        align-items: center;\n        justify-content: space-between;\n        flex-wrap: wrap;\n        gap: 8px;\n        padding: 14px 20px;\n        position: relative;\n        &::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent); }\n        & .count { font-size: .75rem; color: var(--muted); white-space: nowrap; font-weight: 500; letter-spacing: .01em; }\n        & .filter-area { display: flex; gap: 2px; align-items: center; flex-wrap: wrap; }\n        & .filter-bar { display: flex; gap: 2px; }\n        & .filter-btn { padding: 5px 13px; background: none; border: 1px solid transparent; border-radius: 8px; font-size: .75rem; font-family: inherit; font-weight: 500; cursor: pointer; color: var(--muted); transition: all .15s; letter-spacing: .01em; }\n        & .filter-btn:hover { color: var(--text-2); background: var(--surface-2); }\n        & .filter-btn.active { border-color: rgba(167,139,250,.3); color: var(--accent); font-weight: 600; background: rgba(167,139,250,.08); }\n        & .clear-btn { background: none; border: none; font-size: .75rem; font-family: inherit; color: var(--muted); cursor: pointer; padding: 5px 10px; border-radius: 8px; transition: color .15s, background .15s; white-space: nowrap; letter-spacing: .01em; }\n        & .clear-btn:hover { color: var(--red); background: var(--red-glow); }\n    ");
}

function syncStatusStyles() {
  return cssClass("\n        font-size: .68rem;\n        font-weight: 600;\n        letter-spacing: .04em;\n        padding: 3px 10px;\n        border-radius: 99px;\n        opacity: 0;\n        transition: opacity .2s;\n        &.saving { opacity: 1; color: var(--text-2); background: var(--surface-3); }\n        &.saved  { opacity: 1; color: var(--green);  background: rgba(110,231,183,.1); }\n        &.error  { opacity: 1; color: var(--red);    background: var(--red-glow); }\n    ");
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
