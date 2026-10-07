# Claudi MMO

MMORPG 3D low-poly estilo Lineage 2, jugable desde el navegador.

- **Cliente**: Three.js + TypeScript (Vite). Cámara en 3ra persona, click-to-move, UI estilo L2.
- **Servidor**: Node 22 autoritativo (WebSocket, tick 20 Hz), persistencia en SQLite (`node:sqlite`).
- **Shared**: datos del juego (razas, clases, skills, items, mobs, zonas), fórmulas y terreno determinístico.

## Cómo correrlo

```bash
npm install
npm run dev        # server :3001 + Vite :5173 → abrir http://localhost:5173
```

Producción (un solo puerto):

```bash
npm run build
npm start          # http://localhost:3001  (puerto configurable con GAME_PORT)
```

La base de datos queda en `server/data/game.db`.

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
server/src   index.ts (http+ws), db.ts, world/World.ts, world/entities.ts, systems/{player,combat,ai,inventory,party,chat}.ts
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
