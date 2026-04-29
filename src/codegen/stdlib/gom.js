// CodeGen for the GoFront-built-in `gom` DOM-rendering package.

const GOM_ELEMENT_TAGS = {
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
const GOM_ATTR_HELPERS = {
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
	AriaLabel: "aria-label",
};
const GOM_BOOL_ATTRS = {
	Disabled: "disabled",
	Checked: "checked",
	Selected: "selected",
	Readonly: "readonly",
};

export const gomMethods = {
	_genGom(fn, expr) {
		const a = () =>
			expr.args.map((e) =>
				e._spread ? `...${this.genExpr(e)}` : this.genExpr(e),
			);

		if (GOM_ELEMENT_TAGS[fn]) {
			const tag = GOM_ELEMENT_TAGS[fn];
			const args = a();
			if (args.length === 0)
				return `(()=>({Mount(p){const e=document.createElement("${tag}");p.appendChild(e);}}))()`;
			return (
				`((...c)=>({Mount(p){const e=document.createElement("${tag}");c.forEach(n=>n?.Mount?.(e));p.appendChild(e);}}))` +
				`(${args.join(",")})`
			);
		}

		if (GOM_ATTR_HELPERS[fn]) {
			const [v] = a();
			return `((v)=>({Mount(e){e.setAttribute("${GOM_ATTR_HELPERS[fn]}",v)}}))(${v})`;
		}

		if (GOM_BOOL_ATTRS[fn])
			return `({Mount(e){e.setAttribute("${GOM_BOOL_ATTRS[fn]}","")}})`;

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
};
