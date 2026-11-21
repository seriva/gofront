// Names a Go declaration may not keep in the flat JS bundle, and the rename
// applied to them.  Shared by the declaration side (index.js) and the
// bundled-package selector (expressions.js), which must agree.

export {
	JS_RESERVED,
	jsBindingName,
	jsClassName,
	jsMemberName,
	jsSafeName,
} from "../shared/member-names.js";
