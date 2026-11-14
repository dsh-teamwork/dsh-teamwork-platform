// Package ids makes primary keys: 21 characters of nanoid's alphabet, from
// crypto/rand, set by the application on every dialect.
package ids

import "crypto/rand"

const alphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"

// New returns a fresh id.
func New() string {
	var b [21]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand does not fail on a supported platform
	}
	for i := range b {
		b[i] = alphabet[b[i]&63]
	}
	return string(b[:])
}
