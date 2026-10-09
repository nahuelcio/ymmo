# Claudi MMO

MMORPG 3D low-poly estilo Lineage 2, jugable desde el navegador.

- **Cliente**: Three.js + TypeScript (Vite). Cámara en 3ra persona, click-to-move, UI estilo L2.
- **Servidor**: Rust autoritativo (axum + tokio, WS, tick 20 Hz), persistencia en SQLite (`rusqlite`).
- **Shared**: datos del juego (razas, clases, skills, items, mobs, zonas), fórmulas y terreno determinístico.

## Cómo correrlo

```bash
npm run dev        # Docker: cliente (Vite) + servidor (Rust) con hot reload → http://localhost:5173
```

Solo hace falta Docker. La base de datos de dev queda en el volumen `dev-data`.

Producción (un solo puerto):

```bash
docker build -t claudi-mmo .
docker run -p 3001:3001 -v claudi-data:/app/server/data claudi-mmo   # http://localhost:3001
```

Panel de admin: poné `ADMIN_PASSWORD=<8+ caracteres>` en un `.env` (o en el entorno) y escribí `/admin` en el chat del juego (rendimiento por mundo, jugadores, logs, kick y anuncios). Sin esa variable el panel queda desactivado.

## Contenido

- 5 razas (Human, Elf, Dark Elf, Orc, Dwarf) × Fighter / Mystic, niveles 1–20, 6 skills por clase.
- Village of Dawn (zona segura) con Grocer, Weapon/Armor Merchant y Gatekeeper.
- 4 zonas de caza: Windy Meadows (1-5), Goblin Hills (5-10), Orc Barracks (10-15), Cursed Wastes (15-20, raid boss Kaim Vanul).
- Items No-Grade / D / C, drops, adena, inventario, paperdoll, tiendas (compra/venta), pociones y Scroll of Escape.
- Chat (local, `!` shout, `#` party, `"nombre` whisper, `/help`), party con XP compartida, PvP con flag púrpura y karma (PK rojo, drop al morir).

## Controles

Click izquierdo: mover / seleccionar / atacar (2° click) · Click derecho + arrastrar: rotar cámara · Rueda: zoom ·
`1-0`/`F1-F10`: skills y pociones · `Tab`: siguiente objetivo · `Espacio`: atacar · `Z`: recoger ·
`Ctrl+click`: forzar ataque a jugador · `I` inventario · `C` personaje · `M` mapa · `H` ayuda · `Enter` chat.

## Estructura

```
shared/src   protocol.ts, formulas.ts, terrain.ts, data/*
server-rs/src  main.rs (http+ws), db.rs, world.rs, ent.rs, {combat,ai,inventory,party,chat,quests,raid,realm}.rs
client/src   main.ts (login), game.ts (núcleo), render/{scene,models,camera,fx}.ts, ui/*
```

## Deploy en un VPS (Ubuntu/Debian)

Como root, en el servidor:

```bash
curl -fsSL https://raw.githubusercontent.com/nahuelcio/ymmo/main/deploy/install.sh | bash
# con dominio y HTTPS (el dominio tiene que apuntar a la IP del VPS):
curl -fsSL https://raw.githubusercontent.com/nahuelcio/ymmo/main/deploy/install.sh | bash -s mijuego.com
```

Instala la última versión de Node en `/opt/node`, deja el juego como servicio `claudi-mmo` (systemd) detrás de nginx (con WebSocket), abre el firewall y programa un backup diario de la base en `/var/backups/claudi-mmo`.

**Se actualiza solo**: un timer de systemd revisa `main` cada minuto y, si hay commits nuevos, baja, compila y reinicia (si la compilación falla, vuelve a la versión anterior y no corta el juego). Forzar una actualización: `bash /opt/claudi-mmo/deploy/update.sh`. Logs: `journalctl -u claudi-mmo -f` y `journalctl -u claudi-mmo-autoupdate -f`.
