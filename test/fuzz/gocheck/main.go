// gocheck type-checks many small Go programs in one process with go/types
// and prints one result per program. It is the oracle of the checker
// differential fuzzer (test/fuzz/checkfuzz.js).
//
// stdin: a JSON array of {"id", "src", "pkgs"}. `src` is the `main.go` of the
// program; `pkgs` (optional) maps an import path such as "./sub" to the source
// of that one-file package.
//
// stdout: a JSON array of {"id", "ok", "syntax", "line", "col", "msg"}, in
// input order. `line`, `col` and `msg` describe the first error by position;
// `syntax` is set when that error is a parse error. A case with `"all": true`
// also gets "errors": every error of the program, as {"file", "line", "col",
// "msg", "syntax"} in position order (the conformance audit,
// test/fuzz/conformance-go.js, reads it).
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/importer"
	"go/parser"
	"go/scanner"
	"go/token"
	"go/types"
	"os"
	"sort"
	"strings"
)

type input struct {
	ID   string            `json:"id"`
	Src  string            `json:"src"`
	Pkgs map[string]string `json:"pkgs,omitempty"`
	All  bool              `json:"all,omitempty"`
}

type errorItem struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Col    int    `json:"col"`
	Msg    string `json:"msg"`
	Syntax bool   `json:"syntax,omitempty"`
}

type result struct {
	ID     string      `json:"id"`
	OK     bool        `json:"ok"`
	Syntax bool        `json:"syntax,omitempty"`
	Line   int         `json:"line,omitempty"`
	Col    int         `json:"col,omitempty"`
	Msg    string      `json:"msg,omitempty"`
	Errors []errorItem `json:"errors,omitempty"`
}

type finding struct {
	file      string
	line, col int
	msg       string
	syntax    bool
}

// localImporter serves the packages a case carries in `pkgs` and falls back
// to the standard library.
type localImporter struct {
	std   types.Importer
	local map[string]*types.Package
}

func (li localImporter) Import(path string) (*types.Package, error) {
	if pkg, ok := li.local[path]; ok {
		return pkg, nil
	}
	return li.std.Import(path)
}

func checkFile(fset *token.FileSet, name, src string, imp types.Importer) (*types.Package, []finding) {
	var found []finding
	file, err := parser.ParseFile(fset, name, src, parser.SkipObjectResolution)
	if err != nil {
		if list, ok := err.(scanner.ErrorList); ok {
			for _, e := range list {
				found = append(found, finding{name, e.Pos.Line, e.Pos.Column, e.Msg, true})
			}
		} else {
			found = append(found, finding{name, 0, 0, err.Error(), true})
		}
		return nil, found
	}
	conf := types.Config{
		Importer: imp,
		Error: func(err error) {
			if te, ok := err.(types.Error); ok {
				pos := te.Fset.Position(te.Pos)
				found = append(found, finding{name, pos.Line, pos.Column, te.Msg, false})
				return
			}
			found = append(found, finding{name, 0, 0, err.Error(), false})
		},
	}
	pkg, _ := conf.Check(file.Name.Name, fset, []*ast.File{file}, nil)
	return pkg, found
}

func check(in input, std types.Importer) result {
	fset := token.NewFileSet()
	imp := localImporter{std: std, local: map[string]*types.Package{}}
	paths := make([]string, 0, len(in.Pkgs))
	for path := range in.Pkgs {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	var found []finding
	for _, path := range paths {
		pkg, errs := checkFile(fset, path+"/pkg.go", in.Pkgs[path], imp)
		found = append(found, errs...)
		if pkg != nil {
			imp.local[path] = pkg
		}
	}
	_, errs := checkFile(fset, "main.go", in.Src, imp)
	found = append(found, errs...)
	if len(found) == 0 {
		return result{ID: in.ID, OK: true}
	}
	// An error in a local package sorts first and reads `path: msg`, so the
	// first error is the same whatever line it is on.
	pos := func(f finding) (int, int) {
		if f.file != "main.go" {
			return 0, 0
		}
		return f.line, f.col
	}
	sort.SliceStable(found, func(i, j int) bool {
		li, ci := pos(found[i])
		lj, cj := pos(found[j])
		if li != lj {
			return li < lj
		}
		return ci < cj
	})
	first := found[0]
	res := result{ID: in.ID, Syntax: first.syntax, Line: first.line, Col: first.col, Msg: first.msg}
	if first.file != "main.go" {
		res.Line, res.Col = 0, 0
		res.Msg = strings.TrimSuffix(first.file, "/pkg.go") + ": " + first.msg
	}
	if in.All {
		for _, f := range found {
			res.Errors = append(res.Errors, errorItem{f.file, f.line, f.col, f.msg, f.syntax})
		}
	}
	return res
}

func main() {
	var cases []input
	if err := json.NewDecoder(os.Stdin).Decode(&cases); err != nil {
		fmt.Fprintln(os.Stderr, "gocheck: reading cases:", err)
		os.Exit(2)
	}
	std := importer.ForCompiler(token.NewFileSet(), "source", nil)
	results := make([]result, 0, len(cases))
	for _, c := range cases {
		results = append(results, check(c, std))
	}
	if err := json.NewEncoder(os.Stdout).Encode(results); err != nil {
		fmt.Fprintln(os.Stderr, "gocheck: writing results:", err)
		os.Exit(2)
	}
}
