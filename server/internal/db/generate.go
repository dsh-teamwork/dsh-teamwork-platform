package db

//go:generate go run -mod=mod entgo.io/ent/cmd/ent generate --target ./ent --feature sql/upsert,sql/versioned-migration,sql/execquery,sql/modifier ./schema
