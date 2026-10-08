# Claudi MMO: client (Vite) + Rust game server in one small image.
#   docker build -t claudi-mmo . && docker run -p 3001:3001 -v claudi-data:/app/server/data claudi-mmo
FROM node:24-bookworm-slim AS client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run export-data

FROM rust:1-bookworm AS server
WORKDIR /app
COPY server-rs ./server-rs
COPY --from=client /app/server-rs/data/game.json ./server-rs/data/game.json
RUN cargo build --release --manifest-path server-rs/Cargo.toml

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=client /app/client/dist ./client/dist
COPY --from=server /app/server-rs/target/release/claudi-server ./claudi-server
RUN mkdir -p server/data
ENV GAME_PORT=3001 GAME_DB=/app/server/data/game.db CLIENT_DIST=/app/client/dist
EXPOSE 3001
VOLUME ["/app/server/data"]
CMD ["./claudi-server"]
