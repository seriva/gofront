package main

import (
	"strings"
	"testing"
)

func TestExportAndImportCSV(t *testing.T) {
	todos := []Todo{
		{id: 1, text: "Buy milk, eggs", done: false, priority: PriorityHigh},
		{id: 2, text: "Simple task", done: true, priority: PriorityNormal},
	}

	csvStr, err := ExportCSV(todos)
	if err != nil {
		t.Fatalf("ExportCSV failed: %v", err)
	}

	if !strings.Contains(csvStr, "id,text,done,priority") {
		t.Errorf("ExportCSV missing header, got:\n%s", csvStr)
	}
	if !strings.Contains(csvStr, "\"Buy milk, eggs\"") {
		t.Errorf("ExportCSV expected escaped comma, got:\n%s", csvStr)
	}

	imported, err := ImportCSV(csvStr)
	if err != nil {
		t.Fatalf("ImportCSV failed: %v", err)
	}

	if len(imported) != len(todos) {
		t.Fatalf("ImportCSV count = %d, want %d", len(imported), len(todos))
	}
	for i := range todos {
		if imported[i].id != todos[i].id || imported[i].text != todos[i].text || imported[i].done != todos[i].done || imported[i].priority != todos[i].priority {
			t.Errorf("imported[%d] = %+v, want %+v", i, imported[i], todos[i])
		}
	}
}

func TestImportCSVInvalid(t *testing.T) {
	_, err := ImportCSV(`"unterminated quote`)
	if err == nil {
		t.Error("expected error for malformed CSV, got nil")
	}
}
