// CodeGen stdlib call generation methods — installed as a mixin on CodeGen.prototype.
// Handles all built-in package call codegen: fmt, strings, bytes, math, time, etc.

export const stdlibGenMethods = {
	_genBuilderCall(typeName, method, expr) {
		// Resolve the receiver — may be a direct var or a &var (pointer)
		const recv = expr.func.expr;
		const isPtr = recv._type?.kind === "pointer";
		const base = isPtr ? `${this.genExpr(recv)}.value` : this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));

		if (typeName === "strings.Builder") {
			switch (method) {
				case "WriteString":
					return `(${base}._buf += ${args[0]}, [${args[0]}.length, null])`;
				case "WriteByte":
				case "WriteRune":
					return `(${base}._buf += String.fromCodePoint(${args[0]}))`;
				case "Write":
					return `(${base}._buf += String.fromCharCode(...${args[0]}))`;
				case "String":
					return `${base}._buf`;
				case "Len":
					return `${base}._buf.length`;
				case "Reset":
					return `(${base}._buf = "")`;
				case "Grow":
					return "undefined";
			}
		}

		if (typeName === "bytes.Buffer") {
			switch (method) {
				case "WriteString":
					return `(${base}._buf.push(...new TextEncoder().encode(${args[0]})), [${args[0]}.length, null])`;
				case "WriteByte":
					return `${base}._buf.push(${args[0]})`;
				case "Write":
					return `(${base}._buf.push(...${args[0]}), [${args[0]}.length, null])`;
				case "String":
					return `new TextDecoder().decode(new Uint8Array(${base}._buf))`;
				case "Bytes":
					return `${base}._buf.slice()`;
				case "Len":
					return `${base}._buf.length`;
				case "Reset":
					return `(${base}._buf = [])`;
				case "Grow":
					return "undefined";
			}
		}

		return undefined;
	},

	_genRegexp(fn, a) {
		// Converts a Go regexp pattern string (which may contain inline flags like (?i))
		// into a JS RegExp, extracting the flags into the second constructor argument.
		const makeRegExp = (pat) =>
			`((p) => { const m = /^\\(\\?([gimsuy]+)\\)/.exec(p); return m ? new RegExp(p.slice(m[0].length), m[1]) : new RegExp(p); })(${pat})`;
		switch (fn) {
			case "MustCompile":
				return makeRegExp(a()[0]);
			case "Compile":
				return `[${makeRegExp(a()[0])}, null]`;
			case "MatchString": {
				const [pat, s] = a();
				return `[new RegExp(${pat}).test(${s}), null]`;
			}
			case "QuoteMeta":
				return `${a()[0]}.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')`;
		}
		return undefined;
	},

	_genRegexpMethodCall(method, expr) {
		const recv = expr.func.expr;
		// *Regexp is a plain JS RegExp — no .value boxing needed
		const re = this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));

		switch (method) {
			case "MatchString":
				return `${re}.test(${args[0]})`;
			case "FindString":
				return `(${re}.exec(${args[0]})?.[0] ?? "")`;
			case "FindStringIndex":
				return `((m => m ? [m.index, m.index + m[0].length] : null)(${re}.exec(${args[0]})))`;
			case "FindAllString":
				return `[...${args[0]}.matchAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"))].slice(0, ${args[1]} < 0 ? undefined : ${args[1]}).map(m => m[0])`;
			case "FindStringSubmatch":
				return `[...(${re}.exec(${args[0]}) ?? [])]`;
			case "FindAllStringSubmatch":
				return `[...${args[0]}.matchAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"))].slice(0, ${args[1]} < 0 ? undefined : ${args[1]}).map(m => [...m])`;
			case "ReplaceAllString":
				return `${args[0]}.replaceAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"), ${args[1]})`;
			case "ReplaceAllLiteralString":
				return `${args[0]}.replaceAll(new RegExp(${re}.source, ${re}.flags.includes("g") ? ${re}.flags : ${re}.flags + "g"), ${args[1]}.replace(/\\$/g, '$$$$'))`;
			case "Split":
				return `${args[0]}.split(${re}).slice(0, ${args[1]} < 0 ? undefined : ${args[1]})`;
			case "String":
				return `${re}.source`;
		}
		return undefined;
	},

	_genSlices(fn, a) {
		switch (fn) {
			case "Contains": {
				const [s, v] = a();
				return `${s}.includes(${v})`;
			}
			case "Index": {
				const [s, v] = a();
				return `${s}.indexOf(${v})`;
			}
			case "Equal": {
				this._usesEqual = true;
				const [a1, b1] = a();
				return `__equal(${a1}, ${b1})`;
			}
			case "Compare": {
				const [a1, b1] = a();
				return `((a, b) => { for (let i = 0; i < a.length && i < b.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return a.length - b.length; })(${a1}, ${b1})`;
			}
			case "Sort": {
				const [s] = a();
				return `${s}.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)`;
			}
			case "SortFunc": {
				const [s, cmp] = a();
				return `${s}.sort(${cmp})`;
			}
			case "SortStableFunc": {
				const [s, cmp] = a();
				return `${s}.sort(${cmp})`;
			}
			case "IsSorted": {
				const [s] = a();
				return `((s) => { for (let i = 1; i < s.length; i++) { if (s[i] < s[i-1]) return false; } return true; })(${s})`;
			}
			case "IsSortedFunc": {
				const [s, cmp] = a();
				return `((s, f) => { for (let i = 1; i < s.length; i++) { if (f(s[i], s[i-1]) < 0) return false; } return true; })(${s}, ${cmp})`;
			}
			case "Reverse": {
				const [s] = a();
				return `${s}.reverse()`;
			}
			case "Max": {
				const [s] = a();
				return `Math.max(...${s})`;
			}
			case "Min": {
				const [s] = a();
				return `Math.min(...${s})`;
			}
			case "MaxFunc": {
				const [s, cmp] = a();
				return `((s, f) => s.reduce((m, x) => f(x, m) > 0 ? x : m))(${s}, ${cmp})`;
			}
			case "MinFunc": {
				const [s, cmp] = a();
				return `((s, f) => s.reduce((m, x) => f(x, m) < 0 ? x : m))(${s}, ${cmp})`;
			}
			case "Clone": {
				const [s] = a();
				return `${s}.slice()`;
			}
			case "Compact": {
				const [s] = a();
				return `((s) => s.filter((v, i) => i === 0 || v !== s[i-1]))(${s})`;
			}
			case "CompactFunc": {
				const [s, eq] = a();
				return `((s, f) => s.filter((v, i) => i === 0 || !f(v, s[i-1])))(${s}, ${eq})`;
			}
			case "Concat": {
				const args = a();
				return `[].concat(${args.join(", ")})`;
			}
			case "Delete": {
				const [s, i, j] = a();
				return `[...${s}.slice(0, ${i}), ...${s}.slice(${j})]`;
			}
			case "DeleteFunc": {
				const [s, fn2] = a();
				return `${s}.filter((v) => !${fn2}(v))`;
			}
			case "Insert": {
				const args = a();
				const s = args[0];
				const i = args[1];
				const vs = args.slice(2);
				return `[...${s}.slice(0, ${i}), ${vs.join(", ")}, ...${s}.slice(${i})]`;
			}
			case "Replace": {
				const args = a();
				const s = args[0];
				const i = args[1];
				const j = args[2];
				const vs = args.slice(3);
				return `[...${s}.slice(0, ${i}), ${vs.join(", ")}, ...${s}.slice(${j})]`;
			}
			case "Grow":
			case "Clip": {
				const [s] = a();
				return `${s}.slice()`;
			}
		}
		return undefined;
	},

	_genIo(fn, _a, expr) {
		switch (fn) {
			case "WriteString": {
				const writerArg = expr.args[0];
				const writerType = writerArg._type;
				const typeName =
					writerType?.name ??
					(writerType?.kind === "pointer" ? writerType.base?.name : null);
				const w = this.genExpr(writerArg);
				const s = this.genExpr(expr.args[1]);
				const isPtr = writerType?.kind === "pointer";
				const base = isPtr ? `${w}.value` : w;
				if (typeName === "strings.Builder") {
					return `((b,s) => { b._buf += s; return [s.length, null]; })(${base}, ${s})`;
				}
				if (typeName === "bytes.Buffer") {
					return `((b,s) => { b._buf.push(...new TextEncoder().encode(s)); return [s.length, null]; })(${base}, ${s})`;
				}
				// Generic: auto-dereference pointer, then dispatch on concrete writer type.
				// strings.Builder has { _buf: string }, bytes.Buffer has { _buf: [] }.
				return `((b,s) => { const w = b?.value ?? b; if (typeof w.WriteString === "function") return [w.WriteString(s), null]; if (typeof w._buf === "string") { w._buf += s; return [s.length, null]; } if (Array.isArray(w._buf)) { w._buf.push(...new TextEncoder().encode(s)); return [s.length, null]; } return [0, "io.WriteString: unsupported writer"]; })(${w}, ${s})`;
			}
			case "ReadAll": {
				const r = this.genExpr(expr.args[0]);
				return `((r) => { const w = r?.value ?? r; if (typeof w._src === "string") { const s = w._src.slice(w._pos); w._pos = w._src.length; return [[...s].map(c => c.charCodeAt(0)), null]; } if (Array.isArray(w._src)) { const b = w._src.slice(w._pos); w._pos = w._src.length; return [b, null]; } const chunks = []; const buf = new Array(4096); let err = null; while (!err) { const [n, e] = w.Read(buf); if (n > 0) chunks.push(...buf.slice(0, n)); err = e; } return [chunks, err === "EOF" ? null : err]; })(${r})`;
			}
		}
		return undefined;
	},

	_genHtml(fn, a) {
		switch (fn) {
			case "EscapeString": {
				const [s] = a();
				return `${s}.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&#34;").replace(/'/g,"&#39;")`;
			}
			case "UnescapeString": {
				const [s] = a();
				return `${s}.replace(/&#39;/g,"'").replace(/&#34;/g,'"').replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&")`;
			}
		}
		return undefined;
	},

	_genMaps(fn, a) {
		switch (fn) {
			case "Keys": {
				const [m] = a();
				return `Object.keys(${m})`;
			}
			case "Values": {
				const [m] = a();
				return `Object.values(${m})`;
			}
			case "Clone": {
				const [m] = a();
				return `({...${m}})`;
			}
			case "Copy": {
				const [dst, src] = a();
				return `Object.assign(${dst}, ${src})`;
			}
			case "Equal": {
				this._usesEqual = true;
				const [a1, b1] = a();
				return `__equal(${a1}, ${b1})`;
			}
			case "EqualFunc": {
				const [m1, m2, eq] = a();
				return `((a, b, f) => { const ka = Object.keys(a); if (ka.length !== Object.keys(b).length) return false; return ka.every(k => k in b && f(a[k], b[k])); })(${m1}, ${m2}, ${eq})`;
			}
			case "Delete": {
				const [m, k] = a();
				return `(delete ${m}[${k}], undefined)`;
			}
			case "DeleteFunc": {
				const [m, fn2] = a();
				return `Object.keys(${m}).forEach(k => { if (${fn2}(k, ${m}[k])) delete ${m}[k]; })`;
			}
		}
		return undefined;
	},

	typeComment(typeNode) {
		if (!typeNode) return "unknown";
		switch (typeNode.kind) {
			case "TypeName":
				return typeNode.name;
			case "SliceType":
				return `[]${this.typeComment(typeNode.elem)}`;
			case "MapType":
				return `map[${this.typeComment(typeNode.key)}]${this.typeComment(typeNode.value)}`;
			default:
				return typeNode.kind;
		}
	},

	// Dispatch table for stdlib namespace calls (pkg.Func → inline JS).
	// Returns the generated JS string, or undefined if not handled.
	_genStdlibCall(ns, fn, expr) {
		const a = () => expr.args.map((e) => this.genExpr(e));
		switch (ns) {
			case "fmt":
				return this._genFmt(fn, a, expr);
			case "strings":
				return this._genStrings(fn, a);
			case "bytes":
				return this._genBytes(fn, a);
			case "strconv":
				return this._genStrconv(fn, a);
			case "sort":
				return this._genSort(fn, a);
			case "math":
				return this._genMath(fn, a);
			case "unicode":
				return this._genUnicode(fn, a);
			case "os":
				return this._genOs(fn, a);
			case "errors":
				return this._genErrors(fn, a);
			case "time":
				return this._genTime(fn, a);
			case "regexp":
				return this._genRegexp(fn, a);
			case "slices":
				return this._genSlices(fn, a);
			case "maps":
				return this._genMaps(fn, a);
			case "html":
				return this._genHtml(fn, a);
			case "io":
				return this._genIo(fn, a, expr);
			case "rand":
				return this._genRand(fn, a);
			case "utf8":
				return this._genUtf8(fn, a);
			case "path":
				return this._genPath(fn, a, expr);
			case "gom":
				return this._genGom(fn, expr);
			default:
				return undefined;
		}
	},

	_genGom(fn, expr) {
		const a = () =>
			expr.args.map((e) =>
				e._spread ? `...${this.genExpr(e)}` : this.genExpr(e),
			);
		const elementTags = {
			Div: "div",
			Section: "section",
			Article: "article",
			Aside: "aside",
			Header: "header",
			Footer: "footer",
			Main: "main",
			Nav: "nav",
			Figure: "figure",
			H1: "h1",
			H2: "h2",
			H3: "h3",
			H4: "h4",
			H5: "h5",
			H6: "h6",
			Span: "span",
			A: "a",
			Strong: "strong",
			Em: "em",
			Code: "code",
			Pre: "pre",
			Small: "small",
			Mark: "mark",
			P: "p",
			Br: "br",
			Hr: "hr",
			Ul: "ul",
			Ol: "ol",
			Li: "li",
			Dl: "dl",
			Dt: "dt",
			Dd: "dd",
			Form: "form",
			Input: "input",
			Button: "button",
			Textarea: "textarea",
			Select: "select",
			Option: "option",
			Label: "label",
			Fieldset: "fieldset",
			Legend: "legend",
			Img: "img",
			Video: "video",
			Audio: "audio",
			Canvas: "canvas",
			Table: "table",
			Thead: "thead",
			Tbody: "tbody",
			Tfoot: "tfoot",
			Tr: "tr",
			Th: "th",
			Td: "td",
		};
		if (elementTags[fn]) {
			const tag = elementTags[fn];
			const args = a();
			if (args.length === 0)
				return `(()=>({Mount(p){const e=document.createElement("${tag}");p.appendChild(e);}}))()`;
			return (
				`((...c)=>({Mount(p){const e=document.createElement("${tag}");c.forEach(n=>n?.Mount?.(e));p.appendChild(e);}}))` +
				`(${args.join(",")})`
			);
		}
		const attrHelpers = {
			For: "for",
			Name: "name",
			Value: "value",
			Target: "target",
			Rel: "rel",
			Alt: "alt",
			Title: "title",
			Lang: "lang",
			Action: "action",
			Method: "method",
			AutoComplete: "autocomplete",
			Draggable: "draggable",
			Role: "role",
			StyleAttr: "style",
		};
		if (attrHelpers[fn]) {
			const [v] = a();
			return `((v)=>({Mount(e){e.setAttribute("${attrHelpers[fn]}",v)}}))(${v})`;
		}
		if (fn === "AriaLabel") {
			const [v] = a();
			return `((v)=>({Mount(e){e.setAttribute("aria-label",v)}}))(${v})`;
		}
		const boolAttrs = {
			Disabled: "disabled",
			Checked: "checked",
			Selected: "selected",
			Readonly: "readonly",
		};
		if (boolAttrs[fn])
			return `({Mount(e){e.setAttribute("${boolAttrs[fn]}","")}})`;

		const args = a();
		switch (fn) {
			case "El": {
				const [tag, ...children] = args;
				if (children.length === 0)
					return `((t)=>({Mount(p){const e=document.createElement(t);p.appendChild(e);}})) (${tag})`;
				return (
					`((t,...c)=>({Mount(p){const e=document.createElement(t);c.forEach(n=>n?.Mount?.(e));p.appendChild(e);}}))` +
					`(${tag},${children.join(",")})`
				);
			}
			case "Text": {
				const [s] = args;
				return `((s)=>({Mount(p){p.appendChild(document.createTextNode(s))}}))(${s})`;
			}
			case "Attr": {
				const [name, value] = args;
				return `((n,v)=>({Mount(e){e.setAttribute(n,v)}}))(${name},${value})`;
			}
			case "Class":
				return `((v)=>({Mount(e){e.className=v}}))(${args[0]})`;
			case "Type":
				return `((v)=>({Mount(e){e.type=v}}))(${args[0]})`;
			case "Href":
				return `((v)=>({Mount(e){e.href=v}}))(${args[0]})`;
			case "Src":
				return `((v)=>({Mount(e){e.src=v}}))(${args[0]})`;
			case "Placeholder":
				return `((v)=>({Mount(e){e.placeholder=v}}))(${args[0]})`;
			case "DataAttr":
				return `((k,v)=>({Mount(e){e.setAttribute("data-"+k,v)}}))(${args[0]},${args[1]})`;
			case "If":
				return `((c,n)=>c?n:{Mount(){}})(${args[0]},${args[1]})`;
			case "Map":
				return `((s,f)=>{const c=s.map(f);return{_items:c,Mount(p){c.forEach(n=>n.Mount(p))}}})(${args[0]},${args[1]})`;
			case "Style":
				return `((s)=>({Mount(p){const e=document.createElement("style");e.textContent=s;p.appendChild(e);}})) (${args[0]})`;
			case "Mount":
				return `((sel,n)=>{const e=document.querySelector(sel);e.innerHTML="";n.Mount(e)})(${args[0]},${args[1]})`;
			case "MountTo":
				return `((sel,n)=>{const e=document.querySelector(sel);n.Mount(e)})(${args[0]},${args[1]})`;
		}
		return undefined;
	},

	_genFmt(fn, _a, expr) {
		const fmtArgs = expr.args.map((e) => this.genExpr(e)).join(", ");
		switch (fn) {
			case "Sprintf":
				this._usesSprintf = true;
				return `__sprintf(${fmtArgs})`;
			case "Errorf": {
				this._usesSprintf = true;
				this._usesError = true;
				const fmtStr = expr.args[0];
				if (fmtStr?.kind === "BasicLit" && fmtStr.value?.includes("%w")) {
					const lastArg = this.genExpr(expr.args[expr.args.length - 1]);
					return `__error(__sprintf(${fmtArgs}), ${lastArg})`;
				}
				return `__error(__sprintf(${fmtArgs}))`;
			}
			case "Printf":
			case "Print":
				this._usesSprintf = true;
				return `process?.stdout?.write(__sprintf(${fmtArgs}))`;
			case "Println":
				this._usesSprintf = true;
				return `console.log(__sprintf(${fmtArgs}))`;
			case "Fprintf":
			case "Fprintln":
			case "Fprint": {
				this._usesSprintf = true;
				const writerArg = expr.args[0];
				const rest = expr.args.slice(1);
				const restJs = rest.map((e) => this.genExpr(e)).join(", ");
				// Resolve the writer to its underlying buffer expression
				const writerType = writerArg._type;
				const targetTypeName =
					writerType?.name ??
					(writerType?.kind === "pointer" ? writerType.base?.name : null);
				let buf;
				if (targetTypeName === "strings.Builder") {
					const w = this.genExpr(writerArg);
					buf =
						writerType?.kind === "pointer" ? `${w}.value._buf` : `${w}._buf`;
				} else if (targetTypeName === "bytes.Buffer") {
					const w = this.genExpr(writerArg);
					const base = writerType?.kind === "pointer" ? `${w}.value` : w;
					buf = null;
					if (fn === "Fprintf") {
						return `((__b,__s)=>{ __b._buf.push(...new TextEncoder().encode(__s)); })(${base}, __sprintf(${restJs}))`;
					}
					const valJs =
						fn === "Fprintln"
							? `__sprintf("%v\\n", ${restJs})`
							: `__sprintf("%v", ${restJs})`;
					return `((__b,__s)=>{ __b._buf.push(...new TextEncoder().encode(__s)); })(${base}, ${valJs})`;
				} else {
					// Generic io.Writer fallback — call .WriteString if available
					const w = this.genExpr(writerArg);
					const formatted =
						fn === "Fprintf"
							? `__sprintf(${restJs})`
							: fn === "Fprintln"
								? `__sprintf("%v\\n", ${restJs})`
								: `__sprintf("%v", ${restJs})`;
					return `${w}.WriteString(${formatted})`;
				}
				// strings.Builder path
				if (fn === "Fprintf") return `(${buf} += __sprintf(${restJs}))`;
				if (fn === "Fprintln")
					return `(${buf} += __sprintf("%v\\n", ${restJs}))`;
				return `(${buf} += __sprintf("%v", ${restJs}))`;
			}
			case "Sscan": {
				const strArg = this.genExpr(expr.args[0]);
				const restArgs = expr.args
					.slice(1)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, ...ptrs) => { const tokens = str.trim().split(/\\s+/).filter(Boolean); let n = 0; for (let i = 0; i < ptrs.length && i < tokens.length; i++) { const t = tokens[i]; const p = ptrs[i]; if (typeof p.value === "number") p.value = Number(t); else if (typeof p.value === "boolean") p.value = t === "true"; else p.value = t; n++; } return [n, n < ptrs.length ? "unexpected EOF" : null]; })(${strArg}, ${restArgs})`;
			}
			case "Sscanln": {
				const strArg = this.genExpr(expr.args[0]);
				const restArgs = expr.args
					.slice(1)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, ...ptrs) => { const line = str.split("\\n")[0]; const tokens = line.trim().split(/\\s+/).filter(Boolean); let n = 0; for (let i = 0; i < ptrs.length && i < tokens.length; i++) { const t = tokens[i]; const p = ptrs[i]; if (typeof p.value === "number") p.value = Number(t); else if (typeof p.value === "boolean") p.value = t === "true"; else p.value = t; n++; } return [n, n < ptrs.length ? "unexpected EOF" : null]; })(${strArg}, ${restArgs})`;
			}
			case "Sscanf": {
				const strArg = this.genExpr(expr.args[0]);
				const fmtArg = this.genExpr(expr.args[1]);
				const restArgs = expr.args
					.slice(2)
					.map((e) => this.genExpr(e))
					.join(", ");
				return `((str, _fmt, ...ptrs) => { const tokens = str.trim().split(/\\s+/).filter(Boolean); let n = 0; for (let i = 0; i < ptrs.length && i < tokens.length; i++) { const t = tokens[i]; const p = ptrs[i]; if (typeof p.value === "number") p.value = Number(t); else if (typeof p.value === "boolean") p.value = t === "true"; else p.value = t; n++; } return [n, n < ptrs.length ? "input does not match format" : null]; })(${strArg}, ${fmtArg}, ${restArgs})`;
			}
			default:
				return undefined;
		}
	},

	_genStrings(fn, a) {
		const args = a();
		switch (fn) {
			case "Contains":
				return `${args[0]}.includes(${args[1]})`;
			case "HasPrefix":
				return `${args[0]}.startsWith(${args[1]})`;
			case "HasSuffix":
				return `${args[0]}.endsWith(${args[1]})`;
			case "Index":
				return `${args[0]}.indexOf(${args[1]})`;
			case "LastIndex":
				return `${args[0]}.lastIndexOf(${args[1]})`;
			case "Count":
				return `((s, sep) => sep === "" ? s.length + 1 : s.split(sep).length - 1)(${args[0]}, ${args[1]})`;
			case "Repeat":
				return `${args[0]}.repeat(${args[1]})`;
			case "Replace":
				return `${args[0]}.replace(${args[1]}, ${args[2]})`;
			case "ReplaceAll":
				return `${args[0]}.replaceAll(${args[1]}, ${args[2]})`;
			case "ToUpper":
				return `${args[0]}.toUpperCase()`;
			case "ToLower":
				return `${args[0]}.toLowerCase()`;
			case "TrimSpace":
				return `${args[0]}.trim()`;
			case "Trim":
				return `${args[0]}.replace(new RegExp(\`^[\${${args[1]}}]+|[\${${args[1]}}]+$\`, "g"), "")`;
			case "TrimPrefix":
				return `((s, pre) => s.startsWith(pre) ? s.slice(pre.length) : s)(${args[0]}, ${args[1]})`;
			case "TrimSuffix":
				return `((s, suf) => !suf.length || !s.endsWith(suf) ? s : s.slice(0, -suf.length))(${args[0]}, ${args[1]})`;
			case "TrimLeft":
				return `${args[0]}.replace(new RegExp(\`^[\${${args[1]}}]+\`), "")`;
			case "TrimRight":
				return `${args[0]}.replace(new RegExp(\`[\${${args[1]}}]+$\`), "")`;
			case "Split":
				return `${args[0]}.split(${args[1]})`;
			case "Join":
				return `${args[0]}.join(${args[1]})`;
			case "EqualFold":
				return `${args[0]}.toLowerCase() === ${args[1]}.toLowerCase()`;
			case "Fields":
				return `(${args[0]}).trim() === '' ? [] : (${args[0]}).trim().split(/\\s+/)`;
			case "Cut":
				return `((s, sep) => { const i = s.indexOf(sep); return i < 0 ? [s, "", false] : [s.slice(0, i), s.slice(i + sep.length), true]; })(${args[0]}, ${args[1]})`;
			case "CutPrefix":
				return `(${args[0]}).startsWith(${args[1]}) ? [(${args[0]}).slice((${args[1]}).length), true] : [${args[0]}, false]`;
			case "CutSuffix":
				return `(${args[0]}).endsWith(${args[1]}) ? [(${args[0]}).slice(0, -(${args[1]}).length), true] : [${args[0]}, false]`;
			case "SplitN":
				return `((s, sep, n) => { if (n === 0) return []; if (n < 0) return s.split(sep); const r = []; let cur = s; for (let i = 1; i < n && cur.length; i++) { const j = cur.indexOf(sep); if (j < 0) break; r.push(cur.slice(0, j)); cur = cur.slice(j + sep.length); } r.push(cur); return r; })(${args[0]}, ${args[1]}, ${args[2]})`;
			case "SplitAfter":
				return `((s, sep) => { if (sep === "") return [...s]; const r = []; let cur = s; while (cur.length) { const j = cur.indexOf(sep); if (j < 0) { r.push(cur); break; } r.push(cur.slice(0, j + sep.length)); cur = cur.slice(j + sep.length); } return r; })(${args[0]}, ${args[1]})`;
			case "SplitAfterN":
				return `((s, sep, n) => { if (n === 0) return []; if (n < 0 || sep === "") return ((s, sep) => { if (sep === "") return [...s]; const r = []; let cur = s; while (cur.length) { const j = cur.indexOf(sep); if (j < 0) { r.push(cur); break; } r.push(cur.slice(0, j + sep.length)); cur = cur.slice(j + sep.length); } return r; })(s, sep); const r = []; let cur = s; for (let i = 1; i < n && cur.length; i++) { const j = cur.indexOf(sep); if (j < 0) break; r.push(cur.slice(0, j + sep.length)); cur = cur.slice(j + sep.length); } r.push(cur); return r; })(${args[0]}, ${args[1]}, ${args[2]})`;
			case "IndexAny":
				return `((s, chars) => { let m = -1; for (const c of chars) { const i = s.indexOf(c); if (i >= 0 && (m < 0 || i < m)) m = i; } return m; })(${args[0]}, ${args[1]})`;
			case "LastIndexAny":
				return `((s, chars) => { let m = -1; for (const c of chars) { const i = s.lastIndexOf(c); if (i > m) m = i; } return m; })(${args[0]}, ${args[1]})`;
			case "ContainsAny":
				return `[...(${args[1]})].some(c => (${args[0]}).includes(c))`;
			case "ContainsRune":
				return `(${args[0]}).includes(String.fromCodePoint(${args[1]}))`;
			case "IndexRune":
				return `(${args[0]}).indexOf(String.fromCodePoint(${args[1]}))`;
			case "IndexByte":
				return `(${args[0]}).indexOf(String.fromCharCode(${args[1]}))`;
			case "LastIndexByte":
				return `(${args[0]}).lastIndexOf(String.fromCharCode(${args[1]}))`;
			case "Map":
				return `[...(${args[1]})].map(c => String.fromCodePoint((${args[0]})(c.codePointAt(0)))).join("")`;
			case "Title":
				return `(${args[0]}).replace(/\\b\\w/g, c => c.toUpperCase())`;
			case "ToTitle":
				return `(${args[0]}).toUpperCase()`;
			case "TrimFunc":
				return `((s, f) => { let l = 0, r = s.length; while (l < r && f(s.codePointAt(l))) l++; while (r > l && f(s.codePointAt(r - 1))) r--; return s.slice(l, r); })(${args[0]}, ${args[1]})`;
			case "TrimLeftFunc":
				return `((s, f) => { let l = 0; while (l < s.length && f(s.codePointAt(l))) l++; return s.slice(l); })(${args[0]}, ${args[1]})`;
			case "TrimRightFunc":
				return `((s, f) => { let r = s.length; while (r > 0 && f(s.codePointAt(r - 1))) r--; return s.slice(0, r); })(${args[0]}, ${args[1]})`;
			case "IndexFunc":
				return `((s, f) => { for (let i = 0; i < s.length; i++) { const cp = s.codePointAt(i); if (f(cp)) return i; if (cp > 0xFFFF) i++; } return -1; })(${args[0]}, ${args[1]})`;
			case "LastIndexFunc":
				return `((s, f) => { for (let i = s.length - 1; i >= 0; i--) { const cp = s.codePointAt(i); if (f(cp)) return i; } return -1; })(${args[0]}, ${args[1]})`;
			case "NewReader":
				return `{_src: ${args[0]}, _pos: 0, Read(p) { const n = Math.min(p.length, this._src.length - this._pos); for (let i = 0; i < n; i++) p[i] = this._src.charCodeAt(this._pos + i); this._pos += n; return [n, n === 0 ? "EOF" : null]; }, Len() { return this._src.length - this._pos; }, Reset(s) { this._src = s; this._pos = 0; }}`;
			case "NewReplacer": {
				const allArgs = args.join(", ");
				return `((...pairs) => { const p = []; for (let i = 0; i < pairs.length; i += 2) p.push([pairs[i], pairs[i+1]]); return { _p: p, Replace(s) { let r = s; for (const [o, n] of this._p) r = r.split(o).join(n); return r; } }; })(${allArgs})`;
			}
			default:
				return undefined;
		}
	},

	_genBytes(fn, a) {
		const __bs = `(b => String.fromCharCode(...b))`;
		const __sb = `(s => [...s].map(c => c.charCodeAt(0)))`;
		const args = a();
		switch (fn) {
			case "Contains":
				return `${__bs}(${args[0]}).includes(${__bs}(${args[1]}))`;
			case "HasPrefix":
				return `((b, p) => { for (let i = 0; i < p.length; i++) if (b[i] !== p[i]) return false; return b.length >= p.length; })(${args[0]}, ${args[1]})`;
			case "HasSuffix":
				return `((b, s) => { const off = b.length - s.length; if (off < 0) return false; for (let i = 0; i < s.length; i++) if (b[off + i] !== s[i]) return false; return true; })(${args[0]}, ${args[1]})`;
			case "Index":
				return `${__bs}(${args[0]}).indexOf(${__bs}(${args[1]}))`;
			case "Count":
				return `((b, sep) => sep.length === 0 ? b.length + 1 : ${__bs}(b).split(${__bs}(sep)).length - 1)(${args[0]}, ${args[1]})`;
			case "Repeat":
				return `${__sb}(${__bs}(${args[0]}).repeat(${args[1]}))`;
			case "Replace":
				return `((b, o, n, cnt) => { let s = ${__bs}(b), os = ${__bs}(o), ns = ${__bs}(n); if (cnt < 0) return ${__sb}(s.replaceAll(os, ns)); for (let i = 0; i < cnt; i++) s = s.replace(os, ns); return ${__sb}(s); })(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`;
			case "ToUpper":
				return `${__sb}(${__bs}(${args[0]}).toUpperCase())`;
			case "ToLower":
				return `${__sb}(${__bs}(${args[0]}).toLowerCase())`;
			case "TrimSpace":
				return `${__sb}(${__bs}(${args[0]}).trim())`;
			case "Trim":
				return `${__sb}(${__bs}(${args[0]}).replace(new RegExp(\`^[\${${args[1]}}]+|[\${${args[1]}}]+$\`, "g"), ""))`;
			case "Equal":
				return `((a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; })(${args[0]}, ${args[1]})`;
			case "Split":
				return `${__bs}(${args[0]}).split(${__bs}(${args[1]})).map(p => ${__sb}(p))`;
			case "Join":
				return `${__sb}(${args[0]}.map(p => ${__bs}(p)).join(${__bs}(${args[1]})))`;
			case "ReplaceAll":
				return `((b, o, n) => { const r = []; let i = 0; while (i <= b.length - o.length) { if (o.every((v, j) => b[i + j] === v)) { r.push(...n); i += o.length; } else r.push(b[i++]); } return r.concat(b.slice(i)); })(${args[0]}, ${args[1]}, ${args[2]})`;
			case "TrimPrefix":
				return `((b, p) => p.every((v, i) => b[i] === v) ? b.slice(p.length) : b.slice())(${args[0]}, ${args[1]})`;
			case "TrimSuffix":
				return `((b, s) => s.length && s.every((v, i) => b[b.length - s.length + i] === v) ? b.slice(0, -s.length) : b.slice())(${args[0]}, ${args[1]})`;
			case "TrimLeft":
				return `((b, c) => { let i = 0; while (i < b.length && c.includes(String.fromCharCode(b[i]))) i++; return b.slice(i); })(${args[0]}, ${args[1]})`;
			case "TrimRight":
				return `((b, c) => { let i = b.length; while (i > 0 && c.includes(String.fromCharCode(b[i - 1]))) i--; return b.slice(0, i); })(${args[0]}, ${args[1]})`;
			case "TrimFunc":
				return `((b, f) => { let l = 0, r = b.length; while (l < r && f(b[l])) l++; while (r > l && f(b[r - 1])) r--; return b.slice(l, r); })(${args[0]}, ${args[1]})`;
			case "IndexByte":
				return `(${args[0]}).indexOf(${args[1]})`;
			case "LastIndex":
				return `((b, s) => { for (let i = b.length - s.length; i >= 0; i--) if (s.every((v, j) => b[i + j] === v)) return i; return -1; })(${args[0]}, ${args[1]})`;
			case "LastIndexByte":
				return `(${args[0]}).lastIndexOf(${args[1]})`;
			case "Fields":
				return `((b) => { const s = String.fromCharCode(...b).trim(); return s === '' ? [] : s.split(/\\s+/).map(w => [...w].map(c => c.charCodeAt(0))); })(${args[0]})`;
			case "Cut":
				return `((b, sep) => { for (let i = 0; i <= b.length - sep.length; i++) if (sep.every((v, j) => b[i + j] === v)) return [b.slice(0, i), b.slice(i + sep.length), true]; return [b.slice(), [], false]; })(${args[0]}, ${args[1]})`;
			case "ContainsAny":
				return `[...(${args[1]})].some(c => (${args[0]}).includes(c.charCodeAt(0)))`;
			case "ContainsRune":
				return `(${args[0]}).includes(${args[1]})`;
			case "Map":
				return `(${args[1]}).map(v => (${args[0]})(v))`;
			case "SplitN":
				return `((b, sep, n) => { if (n === 0) return []; if (n < 0) return ((b, sep) => { const r = []; let i = 0; while (i <= b.length) { const j = b.findIndex((_, k) => k >= i && sep.every((v, l) => b[k + l] === sep[l])); if (j < 0 || j >= b.length) break; r.push(b.slice(i, j)); i = j + sep.length; } r.push(b.slice(i)); return r; })(b, sep); const r = []; let i = 0; for (let c = 1; c < n; c++) { const j = b.findIndex((_, k) => k >= i && sep.every((v, l) => b[k + l] === sep[l])); if (j < 0) break; r.push(b.slice(i, j)); i = j + sep.length; } r.push(b.slice(i)); return r; })(${args[0]}, ${args[1]}, ${args[2]})`;
			case "NewReader":
				return `{_src: ${args[0]}, _pos: 0, Read(p) { const n = Math.min(p.length, this._src.length - this._pos); for (let i = 0; i < n; i++) p[i] = this._src[this._pos + i]; this._pos += n; return [n, n === 0 ? "EOF" : null]; }, Len() { return this._src.length - this._pos; }, Reset(b) { this._src = b; this._pos = 0; }}`;
			default:
				return undefined;
		}
	},

	_genStrconv(fn, a) {
		const args = a();
		switch (fn) {
			case "Itoa":
				return `String(${args[0]})`;
			case "Atoi":
				return `(Number.isNaN(Number(${args[0]})) ? [0, "invalid syntax"] : [Number(${args[0]}) | 0, null])`;
			case "FormatBool":
				return `String(${args[0]})`;
			case "FormatInt":
				return `(${args[0]}).toString(${args[1]})`;
			case "FormatFloat":
				return `String(${args[0]})`;
			case "ParseFloat":
				return `(Number.isNaN(Number(${args[0]})) ? [0, "invalid syntax"] : [Number(${args[0]}), null])`;
			case "ParseInt":
				return `(Number.isNaN(parseInt(${args[0]}, ${args[1]} || 10)) ? [0, "invalid syntax"] : [parseInt(${args[0]}, ${args[1]} || 10), null])`;
			case "ParseBool":
				return `(${args[0]} === "true" || ${args[0]} === "1" ? [true, null] : ${args[0]} === "false" || ${args[0]} === "0" ? [false, null] : [false, "invalid syntax"])`;
			case "Quote":
				return `JSON.stringify(${args[0]})`;
			case "Unquote":
				return `((s) => { try { const v = JSON.parse(s); return [v, null]; } catch(e) { return ["", "invalid syntax"]; } })(${args[0]})`;
			case "AppendInt":
				return `[...(${args[0]}), ...new TextEncoder().encode((${args[1]}).toString(${args[2]}))]`;
			case "AppendFloat":
				return `[...(${args[0]}), ...new TextEncoder().encode(${args[1]}.toFixed(${args[3]} < 0 ? 6 : ${args[3]}))]`;
			default:
				return undefined;
		}
	},

	_genSort(fn, a) {
		const args = a();
		switch (fn) {
			case "Ints":
			case "Float64s":
				return `${args[0]}.sort((a, b) => a - b)`;
			case "Strings":
				return `${args[0]}.sort()`;
			case "Slice":
			case "SliceStable":
				return `${args[0]}.sort((a, b) => ${args[1]}(a, b) ? -1 : ${args[1]}(b, a) ? 1 : 0)`;
			case "SliceIsSorted":
				return `${args[0]}.every((v, i, a) => i === 0 || ${args[1]}(a[i - 1], v))`;
			case "Search":
				return `((n, f) => { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >>> 1; if (f(mid)) hi = mid; else lo = mid + 1; } return lo; })(${args[0]}, ${args[1]})`;
			case "IntsAreSorted":
			case "Float64sAreSorted":
			case "StringsAreSorted":
				return `(${args[0]}).every((v, i, a) => i === 0 || a[i - 1] <= v)`;
			default:
				return undefined;
		}
	},

	_genMath(fn, a) {
		const args = a();
		switch (fn) {
			case "Abs":
				return `Math.abs(${args[0]})`;
			case "Floor":
				return `Math.floor(${args[0]})`;
			case "Ceil":
				return `Math.ceil(${args[0]})`;
			case "Round":
				return `Math.round(${args[0]})`;
			case "Sqrt":
				return `Math.sqrt(${args[0]})`;
			case "Cbrt":
				return `Math.cbrt(${args[0]})`;
			case "Pow":
				return `Math.pow(${args[0]}, ${args[1]})`;
			case "Log":
				return `Math.log(${args[0]})`;
			case "Log2":
				return `Math.log2(${args[0]})`;
			case "Log10":
				return `Math.log10(${args[0]})`;
			case "Sin":
				return `Math.sin(${args[0]})`;
			case "Cos":
				return `Math.cos(${args[0]})`;
			case "Tan":
				return `Math.tan(${args[0]})`;
			case "Min":
				return `Math.min(${args[0]}, ${args[1]})`;
			case "Max":
				return `Math.max(${args[0]}, ${args[1]})`;
			case "Mod":
				return `${args[0]} % ${args[1]}`;
			case "Inf":
				return `(${args[0]} >= 0 ? Infinity : -Infinity)`;
			case "IsNaN":
				return `Number.isNaN(${args[0]})`;
			case "IsInf":
				return `(${args[1]} > 0 ? ${args[0]} === Infinity : ${args[1]} < 0 ? ${args[0]} === -Infinity : !Number.isFinite(${args[0]}))`;
			case "NaN":
				return "NaN";
			case "Atan":
				return `Math.atan(${args[0]})`;
			case "Atan2":
				return `Math.atan2(${args[0]}, ${args[1]})`;
			case "Asin":
				return `Math.asin(${args[0]})`;
			case "Acos":
				return `Math.acos(${args[0]})`;
			case "Exp":
				return `Math.exp(${args[0]})`;
			case "Exp2":
				return `Math.pow(2, ${args[0]})`;
			case "Trunc":
				return `Math.trunc(${args[0]})`;
			case "Hypot":
				return `Math.hypot(${args[0]}, ${args[1]})`;
			case "Signbit":
				return `(${args[0]} < 0 || Object.is(${args[0]}, -0))`;
			case "Copysign":
				return `(Math.abs(${args[0]}) * (${args[1]} < 0 || Object.is(${args[1]}, -0) ? -1 : 1))`;
			case "Dim":
				return `Math.max(${args[0]} - ${args[1]}, 0)`;
			case "Remainder":
				return `(${args[0]} - Math.round(${args[0]} / ${args[1]}) * ${args[1]})`;
			default:
				return undefined;
		}
	},

	_genUnicode(fn, a) {
		const args = a();
		const cp = `String.fromCodePoint(${args[0]})`;
		switch (fn) {
			case "IsLetter":
				return `/\\p{L}/u.test(${cp})`;
			case "IsDigit":
				return `/\\p{Nd}/u.test(${cp})`;
			case "IsSpace":
				return `/\\s/.test(${cp})`;
			case "IsUpper":
				return `((__c) => __c === __c.toUpperCase() && /\\p{L}/u.test(__c))(${cp})`;
			case "IsLower":
				return `((__c) => __c === __c.toLowerCase() && /\\p{L}/u.test(__c))(${cp})`;
			case "IsPunct":
				return `/\\p{P}/u.test(${cp})`;
			case "IsControl":
				return `/\\p{Cc}/u.test(${cp})`;
			case "IsPrint":
				return `!/\\p{Cc}/u.test(${cp})`;
			case "IsGraphic":
				return `!/\\p{Cc}/u.test(${cp})`;
			case "ToUpper":
				return `${cp}.toUpperCase().codePointAt(0)`;
			case "ToLower":
				return `${cp}.toLowerCase().codePointAt(0)`;
			default:
				return undefined;
		}
	},

	_genOs(fn, a) {
		const args = a();
		switch (fn) {
			case "Exit":
				return `process.exit(${args[0]})`;
			case "Getenv":
				return `(process.env[${args[0]}] ?? "")`;
			default:
				return undefined;
		}
	},

	_genErrors(fn, a) {
		const args = a();
		switch (fn) {
			case "New":
				this._usesError = true;
				return `__error(${args[0]})`;
			case "Is":
				this._usesErrorIs = true;
				return `__errorIs(${args[0]}, ${args[1]})`;
			case "Unwrap":
				return `(${args[0]}?._cause ?? null)`;
			default:
				return undefined;
		}
	},

	_genTimeMethodCall(method, expr) {
		const recv = expr.func.expr;
		const recvJs = this.genExpr(recv);
		const args = expr.args.map((a) => this.genExpr(a));
		switch (method) {
			case "Format":
				this._usesTimeFmt = true;
				return `__timeFmt(${recvJs}._d, ${args[0]})`;
			case "String":
				this._usesTimeFmt = true;
				return `__timeFmt(${recvJs}._d, "2006-01-02T15:04:05Z07:00")`;
			case "Year":
				return `${recvJs}._d.getFullYear()`;
			case "Month":
				return `${recvJs}._d.getMonth() + 1`;
			case "Day":
				return `${recvJs}._d.getDate()`;
			case "Hour":
				return `${recvJs}._d.getHours()`;
			case "Minute":
				return `${recvJs}._d.getMinutes()`;
			case "Second":
				return `${recvJs}._d.getSeconds()`;
			case "Weekday":
				return `${recvJs}._d.getDay()`;
			case "Unix":
				return `Math.floor(${recvJs}._d.getTime() / 1000)`;
			case "UnixMilli":
				return `${recvJs}._d.getTime()`;
			case "Add":
				return `{_d: new Date(${recvJs}._d.getTime() + (${args[0]}))}`;
			case "Sub":
				return `${recvJs}._d.getTime() - (${args[0]})._d.getTime()`;
			case "Before":
				return `${recvJs}._d < (${args[0]})._d`;
			case "After":
				return `${recvJs}._d > (${args[0]})._d`;
			case "Equal":
				return `${recvJs}._d.getTime() === (${args[0]})._d.getTime()`;
			default:
				return undefined;
		}
	},

	_genTime(fn, a) {
		const args = a();
		switch (fn) {
			case "Now":
				return "{_d: new Date()}";
			case "Since":
				return `(Date.now() - (${args[0]})._d.getTime())`;
			case "Sleep":
				return `await new Promise(r => setTimeout(r, ${args[0]} / 1000000))`;
			case "Parse":
				this._usesTimeParse = true;
				return `__timeParse(${args[0]}, ${args[1]})`;
			case "Unix":
				return `{_d: new Date((${args[0]}) * 1000)}`;
			case "Date":
				return `{_d: new Date(${args[0]}, ${args[1]} - 1, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]})}`;
			default:
				return undefined;
		}
	},

	_genRand(fn, a) {
		const args = a();
		switch (fn) {
			case "Intn":
			case "Int63n":
			case "Int31n":
				return `Math.floor(Math.random() * ${args[0]})`;
			case "Float64":
			case "Float32":
				return "Math.random()";
			case "Int":
			case "Int31":
				return "Math.floor(Math.random() * 2147483647)";
			case "Int63":
				return "Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)";
			case "Seed":
				return "(void 0)";
			case "Shuffle":
				return `((n, f) => { for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); f(i, j); } })(${args[0]}, ${args[1]})`;
			case "Perm":
				return `((n) => { const a = Array.from({length: n}, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; })(${args[0]})`;
			default:
				return undefined;
		}
	},

	_genUtf8(fn, a) {
		const args = a();
		switch (fn) {
			case "RuneCountInString":
				return `[...(${args[0]})].length`;
			case "RuneLen":
				return `((r) => r < 0 ? -1 : r <= 0x7F ? 1 : r <= 0x7FF ? 2 : r <= 0xFFFF ? (r >= 0xD800 && r <= 0xDFFF ? -1 : 3) : r <= 0x10FFFF ? 4 : -1)(${args[0]})`;
			case "ValidString":
				return `/[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]/.test(${args[0]}) === false`;
			case "ValidRune":
				return `(${args[0]}) >= 0 && (${args[0]}) <= 0x10FFFF && !((${args[0]}) >= 0xD800 && (${args[0]}) <= 0xDFFF)`;
			case "DecodeRuneInString":
				return `((s) => { if (!s) return [0xFFFD, 0]; const cp = s.codePointAt(0); return [cp, cp > 0xFFFF ? 2 : 1]; })(${args[0]})`;
			case "DecodeLastRuneInString":
				return `((s) => { if (!s) return [0xFFFD, 0]; const i = s.length > 1 && s.charCodeAt(s.length - 1) >= 0xDC00 && s.charCodeAt(s.length - 1) <= 0xDFFF ? s.length - 2 : s.length - 1; const cp = s.codePointAt(i); return [cp, cp > 0xFFFF ? 2 : 1]; })(${args[0]})`;
			case "FullRuneInString":
				return `(${args[0]}).length > 0`;
			default:
				return undefined;
		}
	},

	_genPath(fn, a, expr) {
		const args = a();
		switch (fn) {
			case "Base":
				return `((p) => { if (!p) return "."; const stripped = p.replace(/\\/+$/, ""); if (!stripped) return "/"; const i = stripped.lastIndexOf("/"); return i < 0 ? stripped : stripped.slice(i + 1) || "/"; })(${args[0]})`;
			case "Dir":
				return `((p) => { const i = p.lastIndexOf("/"); if (i < 0) return "."; if (i === 0) return "/"; return p.slice(0, i); })(${args[0]})`;
			case "Ext":
				return `((p) => { const b = p.slice(p.lastIndexOf("/") + 1); const i = b.lastIndexOf("."); return i <= 0 ? "" : b.slice(i); })(${args[0]})`;
			case "Join": {
				this._usesPathClean = true;
				const allArgs = expr.args.map((e) => this.genExpr(e)).join(", ");
				return `__pathClean([${allArgs}].filter(x => x !== "").join("/"))`;
			}
			case "Clean":
				this._usesPathClean = true;
				return `__pathClean(${args[0]})`;
			case "IsAbs":
				return `(${args[0]}).startsWith("/")`;
			case "Split":
				return `((p) => { const i = p.lastIndexOf("/"); return i < 0 ? ["", p] : [p.slice(0, i + 1), p.slice(i + 1)]; })(${args[0]})`;
			case "Match":
				return `((pat, name) => { try { const sp=/[.+^$()|[\\]\\\\]/g; const re = new RegExp("^" + pat.replace(sp, "\\\\$&").replace(/\\*/g, "[^/]*").replace(/\\?/g, "[^/]") + "$"); return [re.test(name), null]; } catch(e) { return [false, "syntax error in pattern"]; } })(${args[0]}, ${args[1]})`;
			default:
				return undefined;
		}
	},
};
