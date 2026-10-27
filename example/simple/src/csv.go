package main

import (
	"errors"
	"strconv"
	"strings"
)

// quoteCSVField wraps a field in quotes when it holds a comma, quote or newline.
func quoteCSVField(s string) string {
	if !strings.ContainsAny(s, ",\"\n\r") {
		return s
	}
	return "\"" + strings.ReplaceAll(s, "\"", "\"\"") + "\""
}

// ExportCSV encodes a slice of todos as CSV text.
func ExportCSV(items []Todo) (string, error) {
	var sb strings.Builder
	sb.WriteString("id,text,done,priority\n")
	for _, t := range items {
		fields := []string{
			strconv.Itoa(t.id),
			quoteCSVField(t.text),
			strconv.FormatBool(t.done),
			strconv.Itoa(t.priority),
		}
		sb.WriteString(strings.Join(fields, ","))
		sb.WriteString("\n")
	}
	return sb.String(), nil
}

// parseCSV splits CSV text into records, honouring quoted fields.
func parseCSV(data string) ([][]string, error) {
	var records [][]string
	var row []string
	var field strings.Builder
	inQuotes := false
	for i := 0; i < len(data); i++ {
		c := data[i]
		if inQuotes {
			if c == '"' {
				if i+1 < len(data) && data[i+1] == '"' {
					field.WriteByte('"')
					i++
				} else {
					inQuotes = false
				}
			} else {
				field.WriteByte(c)
			}
			continue
		}
		switch c {
		case '"':
			inQuotes = true
		case ',':
			row = append(row, field.String())
			field.Reset()
		case '\r':
		case '\n':
			row = append(row, field.String())
			field.Reset()
			records = append(records, row)
			row = nil
		default:
			field.WriteByte(c)
		}
	}
	if inQuotes {
		return nil, errors.New("csv: unterminated quoted field")
	}
	if field.Len() > 0 || len(row) > 0 {
		row = append(row, field.String())
		records = append(records, row)
	}
	return records, nil
}

// ImportCSV parses CSV text into a slice of Todo items.
func ImportCSV(data string) ([]Todo, error) {
	records, err := parseCSV(data)
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
