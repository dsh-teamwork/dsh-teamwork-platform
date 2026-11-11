# The web app, for self-hosting with compose.yaml (README.md, "Self-hosting").
# It applies every migration before it starts serving, the same order Railway
# uses, so a new version never serves against an old schema.
#
# Built from the repository root (`docker build -f apps/web/Dockerfile .`), and
# kept out of the root on purpose: Railway builds any service with a root
# Dockerfile instead of Railpack, which left the console with no build.
FROM node:24.19.0-bookworm-slim

# Prisma's schema engine reads the system's OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm turbo run build --filter=@dsh-teamwork/web

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:deploy && exec pnpm --filter @dsh-teamwork/web start"]
