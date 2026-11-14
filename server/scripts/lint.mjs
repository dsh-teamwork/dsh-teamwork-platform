// The Go side of `pnpm lint`: gofmt finds nothing to change, and go vet passes
// with every build tag the tests use.
import { execFileSync } from 'node:child_process';

const unformatted = execFileSync('gofmt', ['-l', '.'], { encoding: 'utf8' }).trim();
if (unformatted) {
  console.error(`gofmt would change:\n${unformatted}\nRun: gofmt -w server`);
  process.exit(1);
}
execFileSync('go', ['vet', '-tags', 'e2e', './...'], { stdio: 'inherit' });
