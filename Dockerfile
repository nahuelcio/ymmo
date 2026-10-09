# syntax=docker/dockerfile:1
# Claudi MMO: client (Vite) + Rust game server in one small image.
#   docker build -t claudi-mmo . && docker run -p 3001:3001 -v claudi-data:/app/server/data claudi-mmo
FROM node:24-bookworm-slim AS client
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
# only what the client build and export-data read, so a server change doesn't rebuild the client
COPY tsconfig.json ./
COPY shared ./shared
COPY tools/scripts ./tools/scripts
COPY client ./client
RUN mkdir -p server-rs/data && npm run build && npm run export-data

FROM rust:1-bookworm AS server
WORKDIR /app
COPY server-rs ./server-rs
COPY --from=client /app/server-rs/data/game.json ./server-rs/data/game.json
# the cache mounts keep the compiled dependencies between builds; the binary is copied out because they aren't part of the layer
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/server-rs/target \
    cargo build --release --manifest-path server-rs/Cargo.toml && cp server-rs/target/release/claudi-server /claudi-server

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=client /app/client/dist ./client/dist
COPY --from=server /claudi-server ./claudi-server
RUN mkdir -p server/data
ENV GAME_PORT=3001 GAME_DB=/app/server/data/game.db CLIENT_DIST=/app/client/dist
EXPOSE 3001
VOLUME ["/app/server/data"]
CMD ["./claudi-server"]
