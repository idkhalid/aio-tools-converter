# syntax=docker/dockerfile:1.7

FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/aio-api ./cmd/api \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/aio-office-worker ./cmd/office-worker

FROM alpine:3.21 AS api
RUN addgroup -S -g 10001 aio \
    && adduser -S -D -H -u 10001 -G aio aio \
    && mkdir -p /work/jobs /run/aio-office \
    && chown -R 10001:10001 /work/jobs /run/aio-office
COPY --from=build /out/aio-api /usr/local/bin/aio-api
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/aio-api"]

FROM debian:bookworm-slim AS office-worker
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        fontconfig \
        fonts-dejavu-core \
        fonts-liberation \
        libreoffice-writer \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 aio \
    && useradd --system --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent aio \
    && mkdir -p /work/office-jobs /run/aio-office \
    && chown -R 10001:10001 /work/office-jobs /run/aio-office
COPY --from=build /out/aio-office-worker /usr/local/bin/aio-office-worker
USER 10001:10001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
    CMD test -S /run/aio-office/office.sock || exit 1
ENTRYPOINT ["/usr/local/bin/aio-office-worker"]
