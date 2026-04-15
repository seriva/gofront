// Helpers injected by index.html before the app module loads.
declare function sleep(ms: number): Promise<void>;

// ── reactive.js types ────────────────────────────────────────

interface SafeHTML {
	__safe: true;
	content: string;
}

interface Signal {
	get(): any;
	peek(): any;
	set(newVal: any): void;
	subscribe(fn: (value: any) => void): () => void;
	subscribeInternal(fn: (value: any) => void): () => void;
	once(fn: (value: any) => void): () => void;
	update(fn: (current: any) => any): void;
	value: any;
}

interface ComponentContext {
	track(unsub: () => void): () => void;
	computed(fn: () => any, name: string): Signal;
	computedAsync(fn: (cancel: any) => any, name: string): Signal;
	scan(root: any, scope: any): () => void;
	cleanup(): void;
	bind(el: any, sig: Signal, fn: (value: any) => any): () => void;
	bindAttr(el: any, attr: string, sig: Signal): () => void;
	bindBoolAttr(el: any, attr: string, sig: Signal): () => void;
	bindClass(el: any, cls: string, sig: Signal): () => void;
	bindText(el: any, sig: Signal): () => void;
	bindStyle(el: any, prop: string, sig: Signal): () => void;
	bindMultiple(el: any, signals: any, fn: (values: any) => any): () => void;
}

// reactive.js globals (loaded as ESM + assigned to window)
declare function trusted(content: string): SafeHTML;
declare function join(items: any, separator: string): SafeHTML;
declare var css: any;

declare namespace Signals {
	function create(value: any, equals: any, name: string): Signal;
	function computed(fn: () => any, name: string): Signal;
	function computedAsync(fn: (cancel: any) => any, name: string): Signal;
	function batch(fn: () => any): any;
}

declare namespace Reactive {
	function mount(el: any, fn: () => any): any;
	function bind(el: any, sig: Signal, fn: (value: any) => any): () => void;
	function bindAttr(el: any, attr: string, sig: Signal): () => void;
	function bindText(el: any, sig: Signal): () => void;
	function bindBoolAttr(el: any, attr: string, sig: Signal): () => void;
	function bindClass(el: any, cls: string, sig: Signal): () => void;
	function bindStyle(el: any, prop: string, sig: Signal): () => void;
	function bindMultiple(
		el: any,
		signals: any,
		fn: (values: any) => any,
	): () => void;
	function scan(root: any, scope: any): () => void;
	function createComponent(): ComponentContext;
}
