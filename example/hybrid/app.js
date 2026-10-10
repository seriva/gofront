const __gfw_MAX = 9007199254740991n;
function __gfw_imports(stringTable, extraEnv, tag, write) {
	let lineBuf = "";
	let targs = [];
	const flush = () => { write(lineBuf); lineBuf = ""; };
	const print = (v) => {
		const s = String(v);
		if (lineBuf.length > 0 && !lineBuf.endsWith(" ") && !s.startsWith(" ")) {
			lineBuf += " ";
		}
		lineBuf += s;
	};
	const println = (v) => {
		const s = String(v);
		if (lineBuf.length > 0 && !lineBuf.endsWith(" ") && !s.startsWith(" ")) {
			lineBuf += " ";
		}
		lineBuf += s;
		flush();
	};
	const targ = (v) => { targs.push(v); };
	const env = {
		"panicTag": tag,
		"panic": (msg) => {
			let str;
			try {
				str = String(msg);
			} catch {
				str = "[panic object]";
			}
			throw new Error(str);
		},
		"str": (i) => stringTable[i] ?? "",
		"str_len": (s) => (s ? s.length : 0),
		"str_concat": (a, b) => (a ?? "") + (b ?? ""),
		"str_eq": (a, b) => (a === b ? 1 : 0),
		"str_ne": (a, b) => (a !== b ? 1 : 0),
		"str_lt": (a, b) => ((a ?? "") < (b ?? "") ? 1 : 0),
		"str_le": (a, b) => ((a ?? "") <= (b ?? "") ? 1 : 0),
		"str_gt": (a, b) => ((a ?? "") > (b ?? "") ? 1 : 0),
		"str_ge": (a, b) => ((a ?? "") >= (b ?? "") ? 1 : 0),
		"str_get": (s, i) => (s ? s.charCodeAt(i) : 0),
		"str_slice": (s, a, b) => (s ? s.slice(a, b) : ""),
		"str_from_code_point": (c) => String.fromCodePoint(c),
		"str_code_point_at": (s, i) => (s ? s.codePointAt(i) : 0),
		"str_hash": (s) => {
			if (!s) return 0;
			let h = 0;
			for (let i = 0; i < s.length; i++) {
				h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
			}
			return h;
		},
		"str_to_upper": (s) => (s ? s.toUpperCase() : ""),
		"str_to_lower": (s) => (s ? s.toLowerCase() : ""),
		"str_trim_space": (s) => (s ? s.trim() : ""),
		"str_contains": (s, sub) => (s && sub !== undefined ? (s.includes(sub) ? 1 : 0) : 0),
		"str_has_prefix": (s, pre) => (s && pre !== undefined ? (s.startsWith(pre) ? 1 : 0) : 0),
		"str_has_suffix": (s, suf) => (s && suf !== undefined ? (s.endsWith(suf) ? 1 : 0) : 0),
		"str_index": (s, sub) => (s ? s.indexOf(sub) : -1),
		"str_last_index": (s, sub) => (s ? s.lastIndexOf(sub) : -1),
		"str_repeat": (s, n) => (s && n > 0 ? s.repeat(Number(n)) : ""),
		"str_replace_all": (s, o, n) => (s ? s.replaceAll(o, n) : ""),
		"str_equal_fold": (a, b) => ((a ?? "").toLowerCase() === (b ?? "").toLowerCase() ? 1 : 0),
		"str_count": (s, sep) => {
			if (!s) return sep === "" ? 1 : 0;
			if (sep === "") return s.length + 1;
			return s.split(sep).length - 1;
		},
		"str_from_i64": (n) => String(n),
		"str_from_i32": (n) => String(n),
		"str_from_f64": (f) => String(f),
		"is_string": (v) => (typeof v === "string" ? 1 : 0),
		"print_i32": print, "print_i64": print, "print_f32": print, "print_f64": print,
		"print_str": print, "print_any": print,
		"print_bool": (b) => print(b !== 0 ? "true" : "false"),
		"println_i32": println, "println_i64": println, "println_f32": println, "println_f64": println,
		"println_str": println, "println_any": println,
		"println_bool": (b) => println(b !== 0 ? "true" : "false"),
		"println_empty": flush,
		"testing_arg_i32": targ, "testing_arg_f32": targ, "testing_arg_f64": targ,
		"testing_arg_str": targ, "testing_arg_any": targ,
		"testing_arg_i64": (v) => targ(v > __gfw_MAX || v < -__gfw_MAX ? v : Number(v)),
		"testing_arg_bool": (v) => targ(v !== 0),
		"testing_call": (t, i) => { const a = targs; targs = []; t[stringTable[i]](...a); },
		"testing_name": (t) => t.Name(),
		"testing_flag": (t, i) => (t[stringTable[i]]() ? 1 : 0),
	};
	Object.assign(env, extraEnv);
	const m = {};
	for (const k of ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "pow", "exp", "log", "log2", "log10", "round"]) m[k] = Math[k];
	return { "env": env, "Math": m };
}
async function __gfw_fetch(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error("GoFront: failed to fetch " + url + " (" + res.status + ")");
	return res.arrayBuffer();
}
async function __gfw_instantiate(imports) {
	const bytes = globalThis.__GOFRONT_WASM_BYTES;
	if (bytes) return WebAssembly.instantiate(bytes, imports);
	// Resolve relative to the bundle so the app works from any page path.
	const url = globalThis.__GOFRONT_WASM_URL ?? new URL("app.wasm", import.meta.url).href;
	if (typeof WebAssembly.instantiateStreaming === "function") {
		try { return await WebAssembly.instantiateStreaming(fetch(url), imports); }
		catch { /* fall through: wrong MIME type or no streaming support */ }
	}
	return WebAssembly.instantiate(await __gfw_fetch(url), imports);
}
async function __gfw_load(stringTable, extraEnv) {
	if (typeof WebAssembly === "undefined" || typeof WebAssembly.Tag !== "function") {
		throw new Error("GoFront: this runtime lacks the WebAssembly GC / exception support required by app.wasm");
	}
	const tag = new WebAssembly.Tag({ "parameters": ["externref"] });
	const imports = __gfw_imports(stringTable, extraEnv, tag, (s) => console.log(s));
	// Panics arrive as plain JS Errors thrown by env.panic (also from the
	// start function while package-level initializers run), so exports are
	// returned raw: no try/catch wrapper, which keeps JS→wasm calls inlinable.
	const result = await __gfw_instantiate(imports);
	return result.instance.exports;
}
// Go int/int64 cross the boundary as f64 (exact within the safe-integer range).
const __gfw_i64in = (v) => (typeof v === "bigint" ? Number(v) : +v);
const __gfw_i64out = (v) => {
	if (v > __gfw_MAX || v < -__gfw_MAX) throw new RangeError("GoFront: int64 value " + v + " exceeds the safe JS integer range");
	return v;
};
const __gfw_u64out = (v) => {
	if (v < 0 || v > __gfw_MAX) throw new RangeError("GoFront: uint64 value exceeds the safe JS integer range");
	return v;
};
const __gfw_strin = (v) => (v == null ? "" : String(v));
const __gfw_href = (h) => (h == null ? null : h.__ref);
// Tags a struct pointer held in an interface (same marker as the JS backend's __ifp).
const __gfw_ptag = (h) => {
	if (h !== null && h.__p !== true && Object.isExtensible(h)) Object.defineProperty(h, "__p", { "value": true, "configurable": true });
	return h;
};
const __gfw_NIL_DEREF_PATTERNS = [
	"dereferencing a null pointer", // V8
	"dereferencing null pointer", // SpiderMonkey
	"null pointer dereference", // SpiderMonkey
	"null dereference", // JavaScriptCore
];
function __gfw_mapTrap(e) {
	if (typeof WebAssembly !== "undefined" && e instanceof WebAssembly.RuntimeError) {
		const msg = e.message || "";
		for (const p of __gfw_NIL_DEREF_PATTERNS) {
			if (msg.includes(p)) {
				return new Error("runtime error: invalid memory address or nil pointer dereference");
			}
		}
	}
	return e;
}
// Live index view over a wasm array/slice (reads and writes go through to wasm).
function __gfw_idxview(n, getAt, setAt) {
	const inRange = (k) => { if (typeof k !== "string") return -1; const i = +k; return i === (i | 0) && i >= 0 && i < n ? i : -1; };
	return new Proxy(new Array(n), {
		"get": (t, k, r) => { const i = inRange(k); return i < 0 ? Reflect.get(t, k, r) : getAt(i); },
		"set": (t, k, v, r) => { const i = inRange(k); if (i < 0) return Reflect.set(t, k, v, r); setAt(i, v); return true; },
		"has": (t, k) => inRange(k) >= 0 || Reflect.has(t, k),
		"getOwnPropertyDescriptor": (t, k) => {
			const i = inRange(k);
			if (i < 0) return Reflect.getOwnPropertyDescriptor(t, k);
			return { "value": getAt(i), "writable": true, "enumerable": true, "configurable": true };
		},
		"ownKeys": (t) => { const keys = []; for (let i = 0; i < n; i++) keys.push(String(i)); keys.push("length"); return keys; },
	});
}
const __gfw_env = {};
const __w = await __gfw_load(["runtime error: index out of range","runtime error: slice bounds out of range","assignment to entry in nil map","runtime error: integer divide by zero","runtime error: shared buffer length out of range"], __gfw_env);
const __w$memory = __w.memory;
const __w$__shared_base = __w.__shared_base;
const __w$__shared_len = __w.__shared_len;
const __w$__shared_make = __w.__shared_make;
const __w$__var_Positions = __w.__var_Positions;
const __w$__var_Velocities = __w.__var_Velocities;
const __w$__x_Reset = __w.__x_Reset;
const __w$__x_Count = __w.__x_Count;
const __w$Step = __w.Step;
const __w$Energy = __w.Energy;
const __gfw_shc = new WeakMap();
function __gfw_shout(r, Ctor) {
	if (r == null) return null;
	let v = __gfw_shc.get(r);
	if (!v || v.buffer !== __w$memory.buffer) {
		v = new Ctor(__w$memory.buffer, __w$__shared_base(r), __w$__shared_len(r));
		__gfw_shc.set(r, v);
	}
	return v;
}
function __gfw_shin(v, Ctor) {
	if (v == null) return null;
	if (!(v instanceof Ctor) || v.buffer !== __w$memory.buffer) throw new TypeError("GoFront: expected a " + Ctor.name + " view over the wasm shared memory");
	return __w$__shared_make(v.byteOffset, v.length);
}
const MaxParticles = 4096;
const Positions = __gfw_shout(__w$__var_Positions(), Float32Array);
const Velocities = __gfw_shout(__w$__var_Velocities(), Float32Array);
function Reset(a0, a1, a2) {
	try {
		__w$__x_Reset(__gfw_i64in(a0), (+a1), (+a2));
	} catch (e) { throw __gfw_mapTrap(e); }
}
function Count() {
	try {
		return __gfw_i64out(__w$__x_Count());
	} catch (e) { throw __gfw_mapTrap(e); }
}
function Step(a0, a1, a2, a3, a4) {
	try {
		__w$Step((+a0), (+a1), (+a2), (+a3), (+a4));
	} catch (e) { throw __gfw_mapTrap(e); }
}
function Energy() {
	try {
		return __w$Energy();
	} catch (e) { throw __gfw_mapTrap(e); }
}
var __sprintf = __sprintf || function(f, ...a) {
  let i = 0;
  return f.replace(/%([#+\- 0]*)([0-9]*)\.?([0-9]*)[sdvftxXqobeEgGw%]/g, (m) => {
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
      case "d": return pad(String(Math.trunc(Number(v))), width, zero);
      case "v": {
        if (typeof v === "object" && v !== null) {
          if ("re" in v && "im" in v) {
            const sign = v.im >= 0 ? "+" : "";
            return pad("(" + v.re + sign + v.im + "i)", width, false);
          }
          if (typeof v.Error === "function") {
            return pad(String(v.Error()), width, false);
          }
          try {
            return pad(JSON.stringify(v), width, false);
          } catch {
            return pad(String(v), width, false);
          }
        }
        return pad(String(v == null ? "<nil>" : v), width, false);
      }
      case "f": { const n = Number(v), p = prec !== "" ? parseInt(prec) : 6; return pad(n.toFixed(p), width, zero); }
      case "t": return pad(String(!!v), width, false);
      case "x": return pad((Number(v) >>> 0).toString(16), width, zero);
      case "X": return pad((Number(v) >>> 0).toString(16).toUpperCase(), width, zero);
      case "o": return pad((Number(v) >>> 0).toString(8), width, zero);
      case "b": return pad((Number(v) >>> 0).toString(2), width, zero);
      case "q": return pad('"' + String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"', width, false);
      case "e": case "E": { const n = Number(v), p = prec !== "" ? parseInt(prec) : 6; return pad(n.toExponential(p), width, zero); }
      case "g": case "G": { const n = Number(v); return pad(prec !== "" ? n.toPrecision(parseInt(prec)) : String(n), width, zero); }
      case "w": return pad(String(v == null ? "<nil>" : typeof v === "object" && v.Error ? v.Error() : v), width, false);
      default: return m;
    }
  });
};

const canvasW = 640;
const canvasH = 480;

let canvas = null;
let ctx = null;
let paused = false;
let target = 2048;
let lastNow = 0.0;
let frames = 0;
let fpsTime = 0.0;
let fps = 0;
let mouseX = canvasW / 2;
let mouseY = canvasH / 2;
let refs = {  };

function countBtnClass(n, active) {
  if (n === active) {
    return "btn active";
  }
  return "btn";
}

function pauseLabel(paused) {
  if (paused) {
    return "Resume";
  }
  return "Pause";
}

function CountButton(n, active) {
  return {Mount(___p, ___refs) {
    const ___e1 = document.createElement("button");
    ___e1.className = countBtnClass(n, active);
    ___e1.setAttribute("type", "button");
    ___e1.setAttribute("data-action", "count");
    ___e1.setAttribute("data-count", String(n));
    ___e1.appendChild(document.createTextNode(String(n)));
    ___p.appendChild(___e1);
  }};
}

function Controls(target, paused, live) {
  return {Mount(___p, ___refs) {
    const ___e2 = document.createElement("div");
    ___e2.className = "row";
    const ___e3 = document.createElement("span");
    ___e3.className = "label";
    ___e3.appendChild(document.createTextNode("Particles"));
    ___e2.appendChild(___e3);
    (CountButton(512, target)).Mount(___e2, ___refs);
    (CountButton(2048, target)).Mount(___e2, ___refs);
    (CountButton(4096, target)).Mount(___e2, ___refs);
    const ___e4 = document.createElement("button");
    ___e4.className = "btn";
    ___e4.setAttribute("type", "button");
    ___e4.setAttribute("data-action", "pause");
    ___e4.appendChild(document.createTextNode(String(pauseLabel(paused))));
    ___e2.appendChild(___e4);
    const ___e5 = document.createElement("button");
    ___e5.className = "btn";
    ___e5.setAttribute("type", "button");
    ___e5.setAttribute("data-action", "reset");
    ___e5.appendChild(document.createTextNode("Reset"));
    ___e2.appendChild(___e5);
    ___p.appendChild(___e2);
    const ___e6 = document.createElement("div");
    ___e6.className = "row stats";
    const ___e7 = document.createElement("span");
    const ___e8 = document.createElement("strong");
    ___e8.setAttribute("id", "live-count");
    ___e8.appendChild(document.createTextNode(String(live)));
    ___e7.appendChild(___e8);
    ___e7.appendChild(document.createTextNode("live"));
    ___e6.appendChild(___e7);
    const ___e9 = document.createElement("span");
    if(___refs)___refs["fps"]=___e9;
    ___e9.appendChild(document.createTextNode("— fps"));
    ___e6.appendChild(___e9);
    const ___e10 = document.createElement("span");
    ___e10.className = "hint";
    ___e10.appendChild(document.createTextNode("Move the mouse over the canvas to steer the attractor."));
    ___e6.appendChild(___e10);
    ___p.appendChild(___e6);
  }};
}

function render() {
  ((sel,n,r)=>{const e=document.querySelector(sel);e.innerHTML="";n.Mount(e,r)})("#controls",Controls(target, paused, Count()),refs);
}

function frame(now) {
  let dt = Math.fround(Number(0));
  if (lastNow > 0) {
    dt = Math.fround(Number((now - lastNow) / 1000.0));
    if (dt > 0.05) {
      dt = 0.05;
    }
  }
  lastNow = now;
  if (!paused) {
    Step(dt, mouseX, mouseY, canvasW, canvasH);
  }
  ctx.fillStyle = "rgba(13, 15, 18, 0.35)";
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.fillStyle = "#00add8";
  let n = Count();
  let pos = Positions;
  for (let i = 0; i < n; i++) {
    ctx.fillRect(pos[i * 2], pos[i * 2 + 1], 2, 2);
  }
  frames++;
  if (now - fpsTime >= 1000) {
    fps = frames;
    frames = 0;
    fpsTime = now;
    if ((refs["fps"] ?? null) != null) {
      (refs["fps"] ?? null).textContent = __sprintf("%d fps", fps);
    }
  }
  requestAnimationFrame(frame);
}

function setupEvents() {
  canvas.addEventListener("mousemove", function(e) {
    let rect = canvas.getBoundingClientRect();
    mouseX = Math.fround(Number(e.clientX - rect.left)) * canvasW / Math.fround(Number(rect.width));
    mouseY = Math.fround(Number(e.clientY - rect.top)) * canvasH / Math.fround(Number(rect.height));
  });
  let controls = document.querySelector("#controls");
  controls.addEventListener("click", function(e) {
    let btn = e.target.closest("[data-action]");
    if (btn == null) {
      return;
    }
    switch (btn.getAttribute("data-action")) {
      case "count":
      {
        target = Math.trunc(Number(btn.getAttribute("data-count")));
        Reset(target, canvasW, canvasH);
        render();
        break;
      }
      case "pause":
      {
        paused = !paused;
        render();
        break;
      }
      case "reset":
      {
        Reset(target, canvasW, canvasH);
        render();
        break;
      }
    }
  });
}

function main() {
  canvas = document.getElementById("sim");
  ctx = canvas.getContext("2d");
  Reset(target, canvasW, canvasH);
  render();
  setupEvents();
  requestAnimationFrame(frame);
}

main();
