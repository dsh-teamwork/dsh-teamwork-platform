// Command dsh-teamwork is the DSH Teamwork server: the API, the model gateway
// and the console in one binary (ADR 0014). With nothing configured it keeps
// its SQLite database and secrets in ~/.dsh-teamwork and listens on
// 127.0.0.1:3800. This is the community edition: it registers no extension
// (server/edition).
package main

import "github.com/dsh-teamwork/dsh-teamwork-platform/server/app"

var version = "dev"

func main() { app.Main(version) }
