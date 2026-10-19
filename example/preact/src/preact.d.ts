// Preact type declarations for GoFront

export interface VNode {
	type: any;
	props: any;
	key: any;
}

export type ComponentChild =
	| VNode
	| string
	| number
	| boolean
	| null
	| undefined;
export type ComponentChildren = ComponentChild | ComponentChild[];

declare function h(type: any, props?: any, ...children: any[]): VNode;

declare function render(vnode: any, parent: any): void;

declare function useState(
	initialState: any,
): [state: any, setState: (value: any) => void];

declare function useEffect(
	effect: () => undefined | (() => void),
	inputs?: any[],
): void;

declare function useRef(initialValue?: any): { current: any };

declare function useMemo(factory: () => any, inputs?: any[]): any;

declare function useCallback(callback: any, inputs?: any[]): any;

declare function useReducer(
	reducer: (state: any, action: any) => any,
	initialState: any,
): [state: any, dispatch: (action: any) => void];

declare function sleep(ms: number): Promise<void>;
