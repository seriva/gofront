// ===========================================
// REACTIVE SYSTEM
// ===========================================
// Signals-based reactive state management with declarative binding

// ===========================================
// HTML UTILITIES
// ===========================================

/**
 * @typedef {Object} SafeHTML
 * @property {boolean} __safe - Indicates the content is safe HTML
 * @property {string} content - The HTML content
 */

let _escapeElement;

/**
 * Tagged template literal for creating safe HTML content with automatic escaping.
 * Values are automatically escaped unless they are SafeHTML objects.
 *
 * @param {TemplateStringsArray} strings - Template string parts
 * @param {...*} values - Template values to interpolate
 * @returns {SafeHTML} Safe HTML object
 * @example
 * const userInput = "<script>alert('xss')</script>";
 * const safe = html`<div>${userInput}</div>`;
 * // Results in: <div>&lt;script&gt;alert('xss')&lt;/script&gt;</div>
 */
export const html = (strings, ...values) => ({
	__safe: true,
	content: strings.reduce((acc, str, i) => {
		const v = values[i];
		if (v == null) return acc + str;
		if (v.__safe) return acc + str + v.content;
		if (!_escapeElement) _escapeElement = document.createElement("div");
		_escapeElement.textContent = String(v);
		return acc + str + _escapeElement.innerHTML;
	}, ""),
});

/**
 * Marks content as trusted HTML that should not be escaped.
 * Use with caution - only for content you control.
 *
 * @param {string} content - HTML content to mark as trusted
 * @returns {SafeHTML} Safe HTML object
 * @example
 * const icon = trusted("<svg>...</svg>");
 */
export const trusted = (content) => ({ __safe: true, content });

/**
 * Joins multiple items (strings or SafeHTML) with a separator.
 *
 * @param {Array<string|SafeHTML>} items - Items to join
 * @param {string|SafeHTML} [separator=""] - Separator to use between items
 * @returns {SafeHTML} Safe HTML object with joined content
 * @example
 * const list = join([html`<li>A</li>`, html`<li>B</li>`], "\n");
 */
export const join = (items, separator = "") => ({
	__safe: true,
	content: items
		.map((i) => (i?.__safe ? i.content : String(i)))
		.join(typeof separator === "string" ? separator : separator.content || ""),
});

// CSS-in-JS
const _styleCache = new Set();

/**
 * Creates scoped CSS with automatic class name generation and injection.
 * Supports nested selectors with & and automatic prefixing.
 *
 * @param {TemplateStringsArray} strings - Template string parts
 * @param {...*} values - Template values to interpolate
 * @returns {string} Generated CSS class name
 * @example
 * const buttonClass = css`
 *   padding: 10px;
 *   &:hover { background: blue; }
 *   .icon { margin-right: 5px; }
 * `;
 */
export const css = (strings, ...values) => {
	const content = strings.reduce(
		(acc, str, i) => acc + str + (values[i] || ""),
		"",
	);
	// Simple hash for class name
	let hash = 0;
	for (let i = 0; i < content.length; i++)
		hash = (hash << 5) - hash + content.charCodeAt(i);
	const className = `s-${(hash >>> 0).toString(36)}`;

	if (!_styleCache.has(className)) {
		_styleCache.add(className);
		// Skip style injection if document is not available (e.g., in Node.js test environment)
		if (typeof document === "undefined") {
			return className;
		}
		const style = document.createElement("style");
		// Split into rules and process each one
		// For root-level properties (not in a selector), prefix with the class
		// For & selectors, replace with the class
		// For other selectors (like .child), prefix with the class
		let processedContent = content;

		// First, handle & references
		processedContent = processedContent.replace(/&/g, `.${className}`);

		// Then wrap root-level properties (properties before the first {)
		// and prefix child selectors
		const lines = processedContent.split("\n");
		const result = [];
		let inBlock = 0;
		let currentRule = "";
		let rootProperties = "";

		for (const line of lines) {
			const trimmed = line.trim();

			// Count braces to track nesting
			const openBraces = (line.match(/{/g) || []).length;
			const closeBraces = (line.match(/}/g) || []).length;

			if (
				inBlock === 0 &&
				trimmed &&
				!trimmed.startsWith("@") &&
				!trimmed.includes("{") &&
				trimmed.includes(":") &&
				!trimmed.endsWith(",")
			) {
				// Root-level property
				rootProperties += `\t${trimmed}\n`;
			} else if (
				trimmed.startsWith(".") ||
				trimmed.startsWith("@") ||
				trimmed.startsWith(":")
			) {
				// Selector or at-rule
				if (rootProperties) {
					result.push(`.${className} {\n${rootProperties}}\n`);
					rootProperties = "";
				}
				currentRule += `${line}\n`;
			} else {
				currentRule += `${line}\n`;
			}

			inBlock += openBraces - closeBraces;

			if (inBlock === 0 && currentRule.trim()) {
				result.push(currentRule);
				currentRule = "";
			}
		}

		if (rootProperties) {
			result.push(`.${className} {\n${rootProperties}}\n`);
		}
		if (currentRule.trim()) {
			result.push(currentRule);
		}

		style.textContent = result.join("");
		document.head.appendChild(style);
	}
	return className;
};

// ===========================================
// SIGNALS
// ===========================================

/**
 * @typedef {Object} Signal
 * @property {function(): *} get - Get the current value and track dependency
 * @property {function(): *} peek - Get the current value without tracking
 * @property {function(*): void} set - Set a new value
 * @property {function(function(*): void): function(): void} subscribe - Subscribe to changes
 * @property {function(function(*): void): function(): void} subscribeInternal - Internal subscription without immediate call
 * @property {function(function(*): void): function(): void} once - Subscribe and automatically unsubscribe after first call
 * @property {function(function(*): *): void} update - Update value using a function
 * @property {*} value - Getter/setter property for the signal value
 */

/**
 * @typedef {Object} ComputedSignal
 * @extends Signal
 * @property {function(): void} dispose - Clean up subscriptions and dependencies
 */

/**
 * @typedef {Object} AsyncState
 * @property {"pending"|"resolved"|"error"} status - Current status of the async operation
 * @property {*} data - The resolved data (undefined until resolved)
 * @property {Error|null} error - Error object if status is "error"
 * @property {boolean} loading - True when status is "pending"
 */

/**
 * @typedef {Object} CancelToken
 * @property {boolean} cancelled - True if the operation was cancelled
 */

let _activeContext = null;
let _batchPending = false;
const _batchQueue = new Set();
const _batchWrappers = new WeakMap();

// Debug mode
let _debugMode = false;

/**
 * Enable or disable debug mode for reactive system logging.
 * When enabled, logs signal updates, computed recalculations, and async state changes.
 *
 * @param {boolean} enabled - Whether to enable debug mode
 * @example
 * setDebugMode(true); // Enable debug logging
 */
export const setDebugMode = (enabled) => {
	_debugMode = enabled;
};
const _debugLog = (...args) => {
	if (_debugMode) console.log("[Reactive]", ...args);
};

// Circular dependency detection for computed values
const _computeStack = [];

/**
 * Core Signals API for reactive state management.
 * Provides primitives for creating reactive values, computed values, and async computations.
 * @namespace Signals
 */
export const Signals = {
	/**
	 * Creates a reactive signal that holds a single value.
	 * Signals track dependencies and notify subscribers when the value changes.
	 *
	 * @param {*} value - Initial value
	 * @param {function(*, *): boolean} [equals=(a, b) => a === b] - Equality function to determine if value changed
	 * @param {string|null} [name=null] - Optional name for debugging
	 * @returns {Signal} Signal object with get/set/subscribe methods
	 * @example
	 * const count = Signals.create(0, undefined, "count");
	 * count.set(5);
	 * console.log(count.get()); // 5
	 * count.subscribe(val => console.log("Changed:", val));
	 */
	create(value, equals, name = null) {
		if (!equals) equals = (a, b) => a === b;
		const subs = new Set();
		const signal = {
			get() {
				if (_activeContext) _activeContext.add(signal);
				return value;
			},
			peek() {
				return value;
			},
			set(newVal) {
				if (equals(value, newVal)) return;
				const oldVal = value;
				value = newVal;
				_debugLog(
					"Signal updated:",
					name ? `[${name}]` : "",
					oldVal,
					"->",
					newVal,
				);
				if (_batchPending) {
					for (const fn of subs) {
						// Get or create wrapper function for this subscriber that reads latest value
						let wrapper = _batchWrappers.get(fn);
						if (!wrapper) {
							wrapper = () => fn(signal.get());
							_batchWrappers.set(fn, wrapper);
						}
						_batchQueue.add(wrapper);
					}
				} else {
					for (const fn of [...subs]) fn(value);
				}
			},
			subscribe(fn) {
				subs.add(fn);
				fn(value);
				return () => subs.delete(fn);
			},
			subscribeInternal(fn) {
				subs.add(fn);
				return () => subs.delete(fn);
			},
			once(fn) {
				let called = false;
				let unsub;
				const wrapper = (val) => {
					if (!called) {
						called = true;
						fn(val);
						unsub?.();
					}
				};
				unsub = signal.subscribe(wrapper);
				if (called) unsub();
				return unsub;
			},
			update(fn) {
				signal.set(fn(value));
			},
			toString() {
				return name ? `Signal(${name})` : "Signal";
			},
			get value() {
				return signal.get();
			},
			set value(newVal) {
				signal.set(newVal);
			},
		};
		if (name) signal._name = name;
		return signal;
	},

	/**
	 * Creates a computed signal that automatically recalculates when dependencies change.
	 * Dependencies are tracked automatically when accessed inside the computation function.
	 *
	 * @param {function(): *} fn - Computation function that returns the computed value
	 * @param {string|null} [name=null] - Optional name for debugging
	 * @returns {ComputedSignal} Computed signal with dispose method
	 * @throws {Error} If circular dependency is detected
	 * @example
	 * const firstName = Signals.create("John");
	 * const lastName = Signals.create("Doe");
	 * const fullName = Signals.computed(() => `${firstName.get()} ${lastName.get()}`);
	 * console.log(fullName.get()); // "John Doe"
	 */
	computed(fn, name = null) {
		const result = Signals.create(undefined, undefined, name);
		let deps = new Set();
		const unsubs = [];
		let computing = false;

		const run = () => {
			if (computing) return;

			// Circular dependency detection
			if (_computeStack.includes(result)) {
				const cycle = [..._computeStack, result]
					.map((s) => s._name || "anonymous")
					.join(" -> ");
				throw new Error(
					`Circular dependency detected in computed signal: ${cycle}`,
				);
			}

			computing = true;
			_computeStack.push(result);
			const prev = _activeContext;
			_activeContext = new Set();
			try {
				const value = fn();
				_debugLog("Computed updated:", name ? `[${name}]` : "", value);
				result.set(value);
				const newDeps = _activeContext;
				// Remove unused
				[...deps]
					.filter((d) => !newDeps.has(d))
					.forEach((d) => {
						const idx = unsubs.findIndex((u) => u.dep === d);
						if (idx > -1) unsubs.splice(idx, 1)[0].unsub();
					});
				// Add new
				[...newDeps]
					.filter((d) => !deps.has(d))
					.forEach((d) => {
						unsubs.push({ dep: d, unsub: d.subscribeInternal(scheduler) });
					});
				deps = newDeps;
			} catch (error) {
				console.error(
					"[Reactive] Computed error:",
					name ? `[${name}]` : "",
					error,
				);
				throw error;
			} finally {
				_computeStack.pop();
				_activeContext = prev;
				computing = false;
			}
		};

		const scheduler = () => {
			if (_batchPending) _batchQueue.add(run);
			else run();
		};

		run();
		result.dispose = () => {
			for (const u of unsubs) u.unsub();
			unsubs.length = 0;
			deps.clear();
		};
		return result;
	},

	/**
	 * Creates a computed signal for async operations that tracks loading/error/data states.
	 * Automatically cancels previous execution when dependencies change.
	 *
	 * @param {function(CancelToken): Promise<*>} fn - Async computation function
	 * @param {string|null} [name=null] - Optional name for debugging
	 * @returns {ComputedSignal<AsyncState>} Signal containing {status, data, error, loading}
	 * @example
	 * const userId = Signals.create(1);
	 * const userData = Signals.computedAsync(async (cancel) => {
	 *   const response = await fetch(`/api/users/${userId.get()}`);
	 *   if (cancel.cancelled) return;
	 *   return response.json();
	 * });
	 * // userData.get() returns {status: "pending", data: undefined, error: null, loading: true}
	 */
	computedAsync(fn, name = null) {
		const result = Signals.create(
			{ status: "pending", data: undefined, error: null, loading: true },
			undefined,
			name,
		);
		let deps = new Set();
		const unsubs = [];
		let currentCancel = null;

		const run = async () => {
			// Cancel previous execution if still running
			if (currentCancel) {
				currentCancel.cancelled = true;
			}

			// Create cancellation token for this execution
			const cancelToken = { cancelled: false };
			currentCancel = cancelToken;

			// Update state to pending
			result.set({
				status: "pending",
				data: result.peek().data,
				error: null,
				loading: true,
			});

			// Create a dedicated context for this async execution
			const myContext = new Set();
			const prev = _activeContext;
			_activeContext = myContext;

			try {
				const value = await fn(cancelToken);

				// Check if this execution was cancelled
				if (cancelToken.cancelled) {
					_debugLog("Async computed cancelled:", name ? `[${name}]` : "");
					_activeContext = prev;
					return;
				}

				_debugLog("Async computed resolved:", name ? `[${name}]` : "", value);

				result.set({
					status: "resolved",
					data: value,
					error: null,
					loading: false,
				});

				// Use our dedicated context (myContext) instead of whatever _activeContext is now
				const newDeps = myContext;
				_activeContext = prev; // Restore previous context

				// Remove unused
				[...deps]
					.filter((d) => !newDeps.has(d))
					.forEach((d) => {
						const idx = unsubs.findIndex((u) => u.dep === d);
						if (idx > -1) unsubs.splice(idx, 1)[0].unsub();
					});
				// Add new
				[...newDeps]
					.filter((d) => !deps.has(d))
					.forEach((d) => {
						unsubs.push({ dep: d, unsub: d.subscribeInternal(scheduler) });
					});
				deps = newDeps;
			} catch (error) {
				// Check if this execution was cancelled
				if (cancelToken.cancelled) {
					_activeContext = prev;
					return;
				}

				_debugLog("Async computed error:", name ? `[${name}]` : "", error);

				result.set({
					status: "error",
					data: result.peek().data,
					error,
					loading: false,
				});

				_activeContext = prev; // Restore context after error handling
			} finally {
				if (currentCancel === cancelToken) {
					currentCancel = null;
				}
			}
		};

		const scheduler = () => {
			if (_batchPending) _batchQueue.add(run);
			else run();
		};

		run();
		result.dispose = () => {
			if (currentCancel) {
				currentCancel.cancelled = true;
			}
			for (const u of unsubs) u.unsub();
			unsubs.length = 0;
			deps.clear();
		};
		return result;
	},

	/**
	 * Batches multiple signal updates to prevent redundant recalculations.
	 * All updates within the function are queued and executed once at the end.
	 *
	 * @param {function(): *} fn - Function containing signal updates
	 * @returns {*} Return value of the function
	 * @example
	 * Signals.batch(() => {
	 *   count.set(1);
	 *   count.set(2);
	 *   count.set(3);
	 * }); // Subscribers only notified once with value 3
	 */
	batch(fn) {
		_batchPending = true;
		try {
			return fn();
		} finally {
			_batchPending = false;
			const q = new Set(_batchQueue);
			_batchQueue.clear();
			for (const fn of q) fn();
		}
	},
};

// ===========================================
// REACTIVE UTILITIES
// ===========================================

/**
 * Reactive utilities for DOM binding and component management.
 * Provides methods to bind signals to DOM elements and manage reactive components.
 * @namespace Reactive
 */
export const Reactive = {
	/**
	 * Mounts a reactive function to an element, updating its innerHTML.
	 *
	 * @param {HTMLElement} el - Target element
	 * @param {function(): (string|SafeHTML)} fn - Function that returns content
	 * @returns {{update: function(): void}} Object with update method
	 */
	mount(el, fn) {
		const update = () => {
			const res = fn();
			el.innerHTML = res.__safe ? res.content : String(res);
		};
		update();
		return { update };
	},

	/**
	 * Binds a signal to an element's innerHTML through a transformation function.
	 *
	 * @param {HTMLElement} el - Target element
	 * @param {Signal} sig - Signal to bind
	 * @param {function(*): (string|SafeHTML)} fn - Transform function
	 * @returns {function(): void} Unsubscribe function
	 * @example
	 * const count = Signals.create(0);
	 * Reactive.bind(div, count, val => html`Count: ${val}`);
	 */
	bind(el, sig, fn) {
		return sig.subscribe((val) => {
			const res = fn(val);
			el.innerHTML = res.__safe ? res.content : String(res);
		});
	},

	/**
	 * Binds a signal to an element's attribute.
	 *
	 * @param {HTMLElement} el - Target element
	 * @param {string} attr - Attribute name
	 * @param {Signal} sig - Signal to bind
	 * @returns {function(): void} Unsubscribe function
	 * @example
	 * const url = Signals.create("/page");
	 * Reactive.bindAttr(link, "href", url);
	 */
	bindAttr: (el, attr, sig) =>
		sig.subscribe((val) => el.setAttribute(attr, val)),

	/**
	 * Binds a signal to an element's textContent.
	 *
	 * @param {HTMLElement} el - Target element
	 * @param {Signal} sig - Signal to bind
	 * @returns {function(): void} Unsubscribe function
	 * @example
	 * const message = Signals.create("Hello");
	 * Reactive.bindText(span, message);
	 */
	bindText: (el, sig) =>
		sig.subscribe((val) => {
			el.textContent = val;
		}),

	/**
	 * Binds a signal to a boolean attribute (present/absent).
	 *
	 * @param {HTMLElement} el - Target element
	 * @param {string} attr - Attribute name (e.g., "disabled", "hidden")
	 * @param {Signal<boolean>} sig - Signal to bind
	 * @returns {function(): void} Unsubscribe function
	 * @example
	 * const isDisabled = Signals.create(false);
	 * Reactive.bindBoolAttr(button, "disabled", isDisabled);
	 */
	bindBoolAttr: (el, attr, sig) =>
		sig.subscribe((val) =>
			val ? el.setAttribute(attr, "") : el.removeAttribute(attr),
		),

	/**
	 * Binds a signal to toggle a CSS class on an element.
	 *
	 * @param {HTMLElement} el - Target element
	 * @param {string} cls - CSS class name
	 * @param {Signal<boolean>} sig - Signal to bind
	 * @returns {function(): void} Unsubscribe function
	 * @example
	 * const isActive = Signals.create(true);
	 * Reactive.bindClass(div, "active", isActive);
	 */
	bindClass: (el, cls, sig) =>
		sig.subscribe((val) => el.classList.toggle(cls, val)),

	/**
	 * Binds a signal to a CSS style property.
	 *
	 * @param {HTMLElement} el - Target element
	 * @param {string} prop - CSS property name (camelCase)
	 * @param {Signal} sig - Signal to bind
	 * @returns {function(): void} Unsubscribe function
	 * @example
	 * const bgColor = Signals.create("red");
	 * Reactive.bindStyle(div, "backgroundColor", bgColor);
	 */
	bindStyle: (el, prop, sig) =>
		sig.subscribe((val) => {
			el.style[prop] = val;
		}),

	/**
	 * Binds multiple signals to an element using a combine function.
	 * Creates a computed signal that tracks all input signals.
	 *
	 * @param {HTMLElement} el - Target element
	 * @param {Array<Signal>} signals - Array of signals to combine
	 * @param {function(Array<*>): (string|SafeHTML)} fn - Function that combines signal values
	 * @returns {function(): void} Unsubscribe function
	 * @throws {Error} If signals is not an array
	 * @example
	 * const first = Signals.create("John");
	 * const last = Signals.create("Doe");
	 * Reactive.bindMultiple(div, [first, last], ([f, l]) => `${f} ${l}`);
	 */
	bindMultiple(el, signals, fn) {
		if (!Array.isArray(signals)) {
			throw new Error("bindMultiple expects an array of signals");
		}
		const computed = Signals.computed(() => {
			return fn(signals.map((s) => s.get()));
		});
		const unsub = computed.subscribe((val) => {
			el.innerHTML = val?.__safe ? val.content : String(val);
		});
		return () => {
			computed.dispose();
			unsub();
		};
	},

	/**
	 * Scans a DOM tree for data attributes and binds them to signals in the scope.
	 * Supports: data-text, data-html, data-visible, data-if, data-model,
	 * data-class-*, data-attr-*, data-bool-*, data-on-*
	 *
	 * @param {HTMLElement} root - Root element to scan
	 * @param {Object} scope - Object containing signals to bind
	 * @returns {function(): void} Cleanup function to unbind all
	 * @example
	 * const scope = { message: Signals.create("Hello") };
	 * // <div data-text="message"></div>
	 * const cleanup = Reactive.scan(document.body, scope);
	 */
	scan(root, scope) {
		const unsubs = [];
		const resolve = (path) => path.split(".").reduce((o, k) => o?.[k], scope);

		const handlers = {
			"data-text": (el, val) => Reactive.bindText(el, val),
			"data-html": (el, val) => {
				let cleanups = [];
				const unsub = val.subscribe((v) => {
					for (const f of cleanups) f?.();
					cleanups = [];
					el.innerHTML = v?.__safe ? v.content : String(v);

					// Scan children only to avoid infinite recursion on self
					for (const child of el.children) {
						cleanups.push(Reactive.scan(child, scope));
					}
				});
				return () => {
					for (const f of cleanups) f?.();
					unsub();
				};
			},
			"data-visible": (el, val) =>
				val.subscribe((v) => {
					el.style.display = v ? "" : "none";
				}),
			"data-if": (el, val) => {
				const placeholder = document.createComment("if");
				const currentEl = el;
				el.parentNode?.insertBefore(placeholder, el);
				return val.subscribe((v) => {
					if (v && !currentEl.parentNode) {
						placeholder.parentNode?.insertBefore(
							currentEl,
							placeholder.nextSibling,
						);
					} else if (!v && currentEl.parentNode) {
						currentEl.parentNode.removeChild(currentEl);
					}
				});
			},
			"data-model": (el, val) => {
				if (!val?.set) return;
				unsubs.push(
					val.subscribe((v) => {
						if (el.value !== v) el.value = v ?? "";
					}),
				);
				const h = () => val.set(el.value);
				el.addEventListener("input", h);
				return () => el.removeEventListener("input", h);
			},
		};

		const walk = document.createTreeWalker(root, 1);
		let node = walk.currentNode;
		while (node) {
			const el = node;
			if (el.nodeType === 1) {
				for (const { name, value } of [...el.attributes]) {
					const val = resolve(value);
					if (handlers[name]) {
						const u = handlers[name](el, val);
						if (u) unsubs.push(u);
					} else if (name.startsWith("data-class-")) {
						unsubs.push(Reactive.bindClass(el, name.slice(11), val));
					} else if (name.startsWith("data-attr-")) {
						unsubs.push(Reactive.bindAttr(el, name.slice(10), val));
					} else if (name.startsWith("data-bool-")) {
						unsubs.push(Reactive.bindBoolAttr(el, name.slice(10), val));
					} else if (name.startsWith("data-on-")) {
						if (typeof val === "function") {
							const h = (e) => Signals.batch(() => val.call(scope, e));
							const evt = name.slice(8);
							el.addEventListener(evt, h);
							unsubs.push(() => el.removeEventListener(evt, h));
						}
					}
				}
			}
			node = walk.nextNode();
		}
		return () => {
			for (const f of unsubs) f?.();
		};
	},

	/**
	 * Creates a component context for managing subscriptions and computed signals.
	 * Provides methods for tracking cleanup functions and creating scoped reactivity.
	 *
	 * @returns {Object} Component context with track, computed, scan, bind methods
	 * @example
	 * const ctx = Reactive.createComponent();
	 * const count = Signals.create(0);
	 * ctx.bindText(element, count);
	 * ctx.cleanup(); // Cleans up all bindings
	 */
	createComponent() {
		const unsubs = [],
			computed = [];
		const c = {
			track: (u) => {
				if (u) unsubs.push(u);
				return u;
			},
			computed: (fn, name) => {
				const s = Signals.computed(fn, name);
				computed.push(s);
				return s;
			},
			computedAsync: (fn, name) => {
				const s = Signals.computedAsync(fn, name);
				computed.push(s); // Track for disposal
				return s;
			},
			scan: (r, s) => c.track(Reactive.scan(r, s)),
			cleanup: () => {
				for (const f of unsubs) {
					typeof f === "function" ? f() : f?.unsubscribe?.();
				}
				for (const s of computed) s.dispose();
				unsubs.length = computed.length = 0;
			},
		};
		for (const m of [
			"bind",
			"bindAttr",
			"bindBoolAttr",
			"bindClass",
			"bindText",
			"bindStyle",
			"bindMultiple",
		]) {
			c[m] = (...a) => c.track(Reactive[m](...a));
		}
		return c;
	},

	/**
	 * Base class for creating reactive components with lifecycle methods.
	 * Provides automatic state management, DOM binding, and cleanup.
	 *
	 * Lifecycle methods (override in subclass):
	 * - state(): Returns initial state object (converted to signals)
	 * - init(): Called after state initialization, before rendering (optional)
	 * - template(): Returns html tagged template for the component (required)
	 * - styles(): Returns css class name for styling (optional)
	 * - mount(): Called after component is mounted to DOM (optional)
	 * - onCleanup(): Called during cleanup (optional)
	 *
	 * @class
	 * @example
	 * class Counter extends Reactive.Component {
	 *   state() {
	 *     return { count: 0 };
	 *   }
	 *   template() {
	 *     return html`<button data-on-click="increment">${this.count}</button>`;
	 *   }
	 *   increment() {
	 *     this.count.set(this.count.get() + 1);
	 *   }
	 * }
	 */
	Component: class {
		/**
		 * Creates a new component instance.
		 * Initializes internal reactive context and binding methods.
		 */
		constructor() {
			this._c = Reactive.createComponent();
			this.refs = {};
			for (const m of [
				"bind",
				"bindAttr",
				"bindBoolAttr",
				"bindClass",
				"bindText",
				"bindStyle",
				"bindMultiple",
				"track",
			]) {
				this[m] = (...a) => this._c[m](...a);
			}
		}

		/**
		 * Creates a signal within the component.
		 *
		 * @param {*} v - Initial value
		 * @param {string} [name] - Optional name for debugging
		 * @returns {Signal} Signal object
		 */
		signal(v, name) {
			return Signals.create(v, undefined, name);
		}

		/**
		 * Attaches an event listener that's automatically cleaned up.
		 * Handler is wrapped in a batch for efficient updates.
		 *
		 * @param {EventTarget} target - Element to attach listener to
		 * @param {string} event - Event name
		 * @param {function(Event): void} handler - Event handler
		 * @param {Object} [options] - Event listener options
		 * @returns {function(Event): void} Bound handler function
		 */
		on(target, event, handler, options) {
			const boundHandler = (e) => this.batch(() => handler.call(this, e));
			target.addEventListener(event, boundHandler, options);
			this.track(() =>
				target.removeEventListener(event, boundHandler, options),
			);
			return boundHandler;
		}

		/**
		 * Creates a computed signal within the component.
		 * Automatically disposed when component is cleaned up.
		 *
		 * @param {function(): *} fn - Computation function
		 * @param {string} [name] - Optional name for debugging
		 * @returns {ComputedSignal} Computed signal
		 */
		computed(fn, name) {
			return this._c.computed(fn, name);
		}

		/**
		 * Creates an async computed signal within the component.
		 * Automatically disposed when component is cleaned up.
		 *
		 * @param {function(CancelToken): Promise<*>} fn - Async computation function
		 * @param {string} [name] - Optional name for debugging
		 * @returns {ComputedSignal<AsyncState>} Async computed signal
		 */
		computedAsync(fn, name) {
			return this._c.computedAsync(fn, name);
		}

		/**
		 * Creates a side effect that runs when dependencies change.
		 *
		 * @param {function(): void} fn - Effect function
		 * @returns {ComputedSignal} Computed signal (for cleanup)
		 */
		effect(fn) {
			return this.computed(() => {
				fn();
				return undefined;
			});
		}

		/**
		 * Batches multiple signal updates together.
		 *
		 * @param {function(): *} fn - Function containing updates
		 * @returns {*} Return value of the function
		 */
		batch(fn) {
			return Signals.batch(fn);
		}

		/**
		 * Initializes component state by processing the state() method.
		 * Called automatically before rendering. Can be overridden.
		 * Calls init() hook if defined.
		 */
		initState() {
			if (this.state) this._proc(this.state(), this);
			if (this.init) this.init();
		}

		/**
		 * Internal method to process state object, converting values to signals.
		 * Functions become computed signals, objects with .get() are preserved.
		 *
		 * @private
		 * @param {Object} obj - State object to process
		 * @param {Object} tgt - Target object to assign signals to
		 */
		_proc(obj, tgt) {
			Object.entries(obj).forEach(([k, v]) => {
				if (typeof v === "function") tgt[k] = this.computed(v);
				else if (v?.get) tgt[k] = v;
				else if (
					v &&
					typeof v === "object" &&
					!Array.isArray(v) &&
					Object.values(v).some((x) => x?.get)
				)
					tgt[k] = v;
				else tgt[k] = this.signal(v);
			});
		}

		/**
		 * Scans a DOM tree for data attributes and collects refs.
		 * Updates this.refs with elements marked with data-ref.
		 *
		 * @param {HTMLElement} r - Root element to scan
		 * @returns {function(): void} Cleanup function
		 */
		scan(r) {
			// Collect refs - check the root element first, then descendants
			// querySelectorAll only finds descendants, not the element itself
			if (r.hasAttribute?.("data-ref")) {
				const refName = r.getAttribute("data-ref");
				if (refName) this.refs[refName] = r;
			}
			r.querySelectorAll("[data-ref]").forEach((el) => {
				const refName = el.getAttribute("data-ref");
				if (refName) this.refs[refName] = el;
			});
			return this._c.scan(r, this);
		}

		/**
		 * Renders the component by calling template() and applying styles().
		 * Override template() and optionally styles() in your component.
		 *
		 * @returns {HTMLElement} Rendered DOM element
		 * @throws {Error} If template doesn't return valid HTML
		 */
		render() {
			try {
				const t = document.createElement("div");
				const templateResult = this.template();
				if (!templateResult?.content) {
					throw new Error("Template must return html`` tagged template");
				}
				t.innerHTML = templateResult.content;
				const el = t.firstElementChild;
				if (!el) {
					throw new Error("Template must return a single root element");
				}
				if (this.styles) {
					el.classList.add(this.styles());
				}
				this.scan(el);
				return el;
			} catch (error) {
				console.error(
					"[Reactive] Component render error:",
					error,
					this.constructor.name,
				);
				console.error("Stack trace:", error.stack);
				const errorEl = document.createElement("div");
				errorEl.className = "component-error";
				errorEl.style.cssText =
					"padding: 20px; margin: 20px; border: 2px solid #ff6b6b; border-radius: 8px; background: #ffe0e0; color: #c92a2a; font-family: monospace;";
				const setText = (tag, label, text) => {
					const el = document.createElement(tag);
					el.textContent = text;
					if (label) {
						const b = document.createElement("strong");
						b.textContent = label;
						el.prepend(b);
					}
					return el;
				};
				const h3 = document.createElement("h3");
				h3.style.marginTop = "0";
				h3.textContent = "Failed to render component";
				const details = document.createElement("details");
				const summary = document.createElement("summary");
				summary.textContent = "Stack Trace";
				const pre = document.createElement("pre");
				pre.style.overflow = "auto";
				pre.textContent = error.stack;
				details.append(summary, pre);
				errorEl.append(
					h3,
					setText("p", "Component: ", this.constructor.name),
					setText("p", "Error: ", error.message),
					setText("p", "Type: ", error.name),
					details,
				);
				return errorEl;
			}
		}
		mountTo(containerId) {
			const container = document.getElementById(containerId);
			if (!container) {
				console.error(
					`[Reactive] Container #${containerId} not found for component ${this.constructor.name}`,
				);
				return null;
			}
			this.initState();
			const element = this.render();
			container.innerHTML = "";
			container.appendChild(element);
			if (this.mount) this.mount();
			return element;
		}

		/**
		 * Appends the component to a container without clearing it.
		 * Calls lifecycle: state() → init() → render() → mount()
		 *
		 * @param {string} containerId - ID of the container element or "body"
		 * @returns {HTMLElement|null} Rendered element or null if container not found
		 */
		appendTo(containerId) {
			// Special case for body element (no ID)
			const container =
				containerId === "body"
					? document.body
					: document.getElementById(containerId);

			if (!container) {
				console.warn(`Container #${containerId} not found`);
				return null;
			}
			this.initState();
			const element = this.render();
			container.appendChild(element);
			if (this.mount) this.mount();
			return element;
		}

		/**
		 * Cleans up the component by calling onCleanup() hook and disposing all reactive bindings.
		 * Automatically called when component is destroyed.
		 */
		cleanup() {
			if (this.onCleanup) this.onCleanup();
			this._c.cleanup();
			this.refs = {};
		}
	},
};
