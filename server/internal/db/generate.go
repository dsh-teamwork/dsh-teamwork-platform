package db

// Keep generated JSON types on the module's declared Go version. In particular,
// Go 1.27 emits encoding/json/jsontext, which the Go 1.26 image cannot build.
//go:generate env GOTOOLCHAIN=go1.26.4 go run -mod=mod entgo.io/ent/cmd/ent generate --target ./ent --feature sql/upsert,sql/versioned-migration,sql/execquery,sql/modifier ./schema
