// src/backend/js/stdlib/sync.js
// CodeGen for Go sync package.

export const syncMethods = {
	_genSync(fn) {
		this.useHelper("sync");
		if (fn === "Once") return "__sync_once()";
		if (fn === "Mutex") return "__sync_mutex()";
		if (fn === "RWMutex") return "__sync_rwmutex()";
		if (fn === "WaitGroup") return "__sync_waitgroup()";
		return undefined;
	},
};
