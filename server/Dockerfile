# The DSH Teamwork server as a container (ADR 0014): the console built and
# embedded, one static binary, nothing else. Built from the repository root:
#
#   docker build -f server/Dockerfile .
#
# Kept out of the root on purpose: Railway builds any service with a root
# Dockerfile instead of Railpack. LEGAL_DIR, at build, publishes /privacy and
# /terms from that directory (ADR 0007); APP_URL and every other setting are
# read when the container runs.

# Both build stages run on the builder's own platform: the console is the same
# files everywhere, and Go cross-compiles, so an arm64 image needs no emulation.
FROM --platform=$BUILDPLATFORM node:24.19.0-bookworm-slim AS console
WORKDIR /src
RUN corepack enable
COPY . .
ARG LEGAL_DIR
# Only the console's own modules; the root's postinstall belongs to Prisma.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @dsh-teamwork/console... \
  && pnpm --filter @dsh-teamwork/console build

FROM --platform=$BUILDPLATFORM golang:1.26-bookworm AS server
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=console /src/apps/console/dist ./internal/web/dist
ARG VERSION=dev TARGETOS TARGETARCH
RUN mkdir /data && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /dsh-teamwork ./cmd/dsh-teamwork

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /dsh-teamwork /dsh-teamwork
# The data directory belongs to the user the binary runs as.
COPY --from=server --chown=65532:65532 /data /data
# Every interface, inside the container: the port is what is published.
ENV HOST=0.0.0.0 PORT=3000
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["/dsh-teamwork", "--data", "/data"]
