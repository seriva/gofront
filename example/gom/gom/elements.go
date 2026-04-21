package gom

// ── Block elements ────────────────────────────────────────────

func Div(children ...Node) Node     { return El("div", children...) }
func Section(children ...Node) Node { return El("section", children...) }
func Article(children ...Node) Node { return El("article", children...) }
func Aside(children ...Node) Node   { return El("aside", children...) }
func Header(children ...Node) Node  { return El("header", children...) }
func Footer(children ...Node) Node  { return El("footer", children...) }
func Main(children ...Node) Node    { return El("main", children...) }
func Nav(children ...Node) Node     { return El("nav", children...) }
func Figure(children ...Node) Node  { return El("figure", children...) }

// ── Headings ──────────────────────────────────────────────────

func H1(children ...Node) Node { return El("h1", children...) }
func H2(children ...Node) Node { return El("h2", children...) }
func H3(children ...Node) Node { return El("h3", children...) }
func H4(children ...Node) Node { return El("h4", children...) }
func H5(children ...Node) Node { return El("h5", children...) }
func H6(children ...Node) Node { return El("h6", children...) }

// ── Inline elements ───────────────────────────────────────────

func Span(children ...Node) Node   { return El("span", children...) }
func A(children ...Node) Node      { return El("a", children...) }
func Strong(children ...Node) Node { return El("strong", children...) }
func Em(children ...Node) Node     { return El("em", children...) }
func Code(children ...Node) Node   { return El("code", children...) }
func Pre(children ...Node) Node    { return El("pre", children...) }
func Small(children ...Node) Node  { return El("small", children...) }
func Mark(children ...Node) Node   { return El("mark", children...) }

// ── Text-level ────────────────────────────────────────────────

func P(children ...Node) Node  { return El("p", children...) }
func Br() Node                 { return El("br") }
func Hr() Node                 { return El("hr") }

// ── Lists ─────────────────────────────────────────────────────

func Ul(children ...Node) Node { return El("ul", children...) }
func Ol(children ...Node) Node { return El("ol", children...) }
func Li(children ...Node) Node { return El("li", children...) }
func Dl(children ...Node) Node { return El("dl", children...) }
func Dt(children ...Node) Node { return El("dt", children...) }
func Dd(children ...Node) Node { return El("dd", children...) }

// ── Forms ─────────────────────────────────────────────────────

func Form(children ...Node) Node     { return El("form", children...) }
func Input(children ...Node) Node    { return El("input", children...) }
func Button(children ...Node) Node   { return El("button", children...) }
func Textarea(children ...Node) Node { return El("textarea", children...) }
func Select(children ...Node) Node   { return El("select", children...) }
func Option(children ...Node) Node   { return El("option", children...) }
func Label(children ...Node) Node    { return El("label", children...) }
func Fieldset(children ...Node) Node { return El("fieldset", children...) }
func Legend(children ...Node) Node   { return El("legend", children...) }

// ── Media ─────────────────────────────────────────────────────

func Img(children ...Node) Node    { return El("img", children...) }
func Video(children ...Node) Node  { return El("video", children...) }
func Audio(children ...Node) Node  { return El("audio", children...) }
func Canvas(children ...Node) Node { return El("canvas", children...) }

// ── Table ─────────────────────────────────────────────────────

func Table(children ...Node) Node   { return El("table", children...) }
func Thead(children ...Node) Node   { return El("thead", children...) }
func Tbody(children ...Node) Node   { return El("tbody", children...) }
func Tfoot(children ...Node) Node   { return El("tfoot", children...) }
func Tr(children ...Node) Node      { return El("tr", children...) }
func Th(children ...Node) Node      { return El("th", children...) }
func Td(children ...Node) Node      { return El("td", children...) }

// ── Attribute helpers ─────────────────────────────────────────

func For(v string) Node          { return Attr("for", v) }
func Name(v string) Node         { return Attr("name", v) }
func Value(v string) Node        { return Attr("value", v) }
func Target(v string) Node       { return Attr("target", v) }
func Rel(v string) Node          { return Attr("rel", v) }
func Alt(v string) Node          { return Attr("alt", v) }
func Title(v string) Node        { return Attr("title", v) }
func Lang(v string) Node         { return Attr("lang", v) }
func Action(v string) Node       { return Attr("action", v) }
func Method(v string) Node       { return Attr("method", v) }
func AutoComplete(v string) Node { return Attr("autocomplete", v) }
func Draggable(v string) Node    { return Attr("draggable", v) }
func Role(v string) Node         { return Attr("role", v) }
func AriaLabel(v string) Node    { return Attr("aria-label", v) }

// Disabled returns a boolean attribute node that marks an element as disabled.
func Disabled() Node { return Attr("disabled", "") }

// Checked returns a boolean attribute node for checked checkboxes/radios.
func Checked() Node { return Attr("checked", "") }

// Selected returns a boolean attribute node for selected options.
func Selected() Node { return Attr("selected", "") }

// Readonly returns a boolean attribute node for read-only inputs.
func Readonly() Node { return Attr("readonly", "") }

// StyleAttr sets an inline style string on an element.
func StyleAttr(v string) Node { return Attr("style", v) }
