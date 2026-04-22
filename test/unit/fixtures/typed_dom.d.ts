// Typed DOM subset for GoFront tests.
// Use with `import "js:typed_dom.d.ts"` — document is already a global
// so we redeclare it with a stronger type here.

interface CSSStyleDeclaration {
	textDecoration: string;
	color: string;
	display: string;
	background: string;
}

interface HTMLElement {
	id: string;
	textContent: string;
	innerHTML: string;
	value: string;
	className: string;
	style: CSSStyleDeclaration;
	appendChild(child: HTMLElement): void;
	removeChild(child: HTMLElement): void;
	addEventListener(event: string, handler: () => void): void;
	click(): void;
	setAttribute(name: string, value: string): void;
	getAttribute(name: string): string;
}

interface Document {
	getElementById(id: string): HTMLElement;
	createElement(tag: string): HTMLElement;
	querySelector(sel: string): HTMLElement;
}

declare var document: Document;
