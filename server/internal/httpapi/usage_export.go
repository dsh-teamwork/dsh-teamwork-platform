package httpapi

import (
	"bytes"
	"encoding/csv"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// csvCell prevents imported names from becoming spreadsheet formulas, including
// formulas hidden after whitespace or control characters.
func csvCell(s string) string {
	v := strings.TrimLeftFunc(s, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) })
	if v != "" && strings.ContainsRune("=+-@", rune(v[0])) {
		return "'" + s
	}
	return s
}

func (s *Server) exportUsage(w http.ResponseWriter, r *http.Request) error {
	f, err := s.usageFilter(r)
	if err != nil {
		return err
	}
	if f.Until.IsZero() {
		f.Until = time.Now().UTC()
	}
	rows, err := s.Usage.Export(r.Context(), f)
	if err != nil {
		return err
	}
	var out bytes.Buffer
	writer := csv.NewWriter(&out)
	writer.UseCRLF = true
	_ = writer.Write([]string{"request_id", "created_at", "finished_at", "user_id", "config_id", "provider", "model", "state", "code", "input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "reasoning_tokens", "points", "meter", "quantity", "unit"})
	number := func(n *int64) string {
		if n == nil {
			return ""
		}
		return strconv.FormatInt(*n, 10)
	}
	value := func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	}
	for _, row := range rows {
		cells := []string{row.ID, row.CreatedAt, value(row.FinishedAt), row.UserID, row.ConfigID, row.Provider, row.Model, row.State, row.Code,
			number(row.Input), number(row.CacheRead), number(row.CacheWrite), number(row.Output), number(row.Reasoning), value(row.Points), "", "", ""}
		if row.Meter != nil {
			cells[15], cells[16], cells[17] = row.Meter.Name, number(row.Meter.Quantity), row.Meter.Unit
		}
		for i := range cells {
			cells[i] = csvCell(cells[i])
		}
		if err := writer.Write(cells); err != nil {
			return err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return err
	}
	noStore(w)
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="teamwork-usage.csv"`)
	w.WriteHeader(http.StatusOK)
	_, err = w.Write(out.Bytes())
	return err
}
