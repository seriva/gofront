package main

import (
	"bytes"
	"encoding/csv"
	"strconv"
	"strings"
)

// ExportCSV encodes a slice of todos as CSV text.
func ExportCSV(items []Todo) (string, error) {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if err := w.Write([]string{"id", "text", "done", "priority"}); err != nil {
		return "", err
	}
	for _, t := range items {
		record := []string{
			strconv.Itoa(t.id),
			t.text,
			strconv.FormatBool(t.done),
			strconv.Itoa(t.priority),
		}
		if err := w.Write(record); err != nil {
			return "", err
		}
	}
	w.Flush()
	return buf.String(), w.Error()
}

// ImportCSV parses CSV text into a slice of Todo items.
func ImportCSV(data string) ([]Todo, error) {
	r := csv.NewReader(strings.NewReader(data))
	records, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}
	var result []Todo
	start := 0
	if len(records) > 0 && len(records[0]) >= 2 && records[0][0] == "id" && records[0][1] == "text" {
		start = 1
	}
	for i := start; i < len(records); i++ {
		row := records[i]
		if len(row) < 4 {
			continue
		}
		id, _ := strconv.Atoi(row[0])
		done, _ := strconv.ParseBool(row[2])
		priority, _ := strconv.Atoi(row[3])
		result = append(result, Todo{
			id:       id,
			text:     row[1],
			done:     done,
			priority: priority,
		})
	}
	return result, nil
}
