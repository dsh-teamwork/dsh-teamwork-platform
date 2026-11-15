package usage

import (
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"math"
)

const UnitsPerPoint = edition.UnitsPerPoint

var ErrAmount = edition.ErrAmount

type Rates = edition.Rates
type Tokens = edition.Tokens

func Decimal(s string, places int) (int64, error) { return edition.Decimal(s, places) }
func FormatPoints(units int64) string             { return edition.FormatPoints(units) }

// Public window counters also use checked addition.
func addProduct(sum, count, rate int64) (int64, error) {
	if count < 0 || rate < 0 || rate != 0 && count > (math.MaxInt64-sum)/rate {
		return 0, ErrAmount
	}
	return sum + count*rate, nil
}
