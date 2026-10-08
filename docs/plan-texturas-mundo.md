# Plan: texturizar el mundo

Rama: `feat/world-textures`

## Contexto

Hoy el mundo no usa ninguna textura. Todo se pinta con colores planos.

- **Terreno** ([client/src/render/scene.ts](../client/src/render/scene.ts), `buildTerrain`): está dividido en chunks de 200 u. Usa `MeshLambertMaterial({ vertexColors, flatShading })`. El color de cada vértice sale de `groundColor(x, z, h)`, que mezcla pasto, tinte por zona, roca por altura, nieve, caminos, pueblo, arena y fondo de laguna. Después se le aplica un oscurecido extra en las pendientes.
- **Edificios y props**: son primitivas (`box`, `gable`, `house`, `tavern`, `townHall`, `smithy`…) con materiales de color cacheados en `mat(color)`. Después se fusionan con `mergeStatic`.
- **Vegetación y rocas**: son `InstancedMesh` por chunk (`chunkedInstances`) y el color va por instancia. El pasto y las flores usan `sway()` ([atmos.ts](../client/src/render/atmos.ts)), que ya los modifica con `onBeforeCompile`.
- **Agua**: ya tiene su propio `ShaderMaterial` (`waterMaterial`).
- **Gráficos**: hay presets low/medium/high en [settings.ts](../client/src/settings.ts) y los equipos débiles caen a `medium`.

**Objetivo:** que el suelo, la roca y los edificios tengan detalle de superficie (pasto, tierra, piedra, madera, tejas) sin perder el estilo low-poly. No debe sumar descargas pesadas ni romper el rendimiento en equipos modestos y móviles.

## Decisiones

1. **Texturas procedurales generadas en el cliente (primera etapa).** Se dibujan en canvas al cargar: 6–8 texturas de 256–512 px, repetibles y con estilo "pintado a mano" a partir de ruido. Ventajas:
   - Descarga cero y ninguna licencia que gestionar.
   - Combinan con el low-poly.
   - Se pueden ajustar desde el código.

   Las texturas CC0 externas (ambientCG / Poly Haven en KTX2) quedan como opción para una segunda etapa, si el resultado procedural no alcanza.
2. **El terreno se pinta por mezcla de capas (*splatting*).** Se mantiene `groundColor` como tinte de cada zona, para que el minimapa y la identidad de cada zona sigan iguales. A eso se le suma un atributo de pesos por vértice que dice cuánto hay de cada capa: pasto, tierra/camino, roca, arena, nieve, empedrado.
3. **Coordenadas de textura según la posición en el mundo**, no las UV de cada malla. Para edificios y rocas se proyecta la textura desde los tres ejes (*triplanar*). Así no hay que tocar UVs de cada caja y la textura no se estira en las primitivas escaladas ni en las fusionadas.
4. **Se inyecta en los materiales existentes con `onBeforeCompile`**, el mismo patrón de `sway()`. No se reemplazan por shaders propios, así que siguen funcionando las luces, sombras, niebla, el ciclo día/noche y las luces locales.
5. **Nueva opción `textures: 'off' | 'low' | 'high'`** dentro de los presets:
   - `off`: igual que hoy, para el preset low y móviles débiles.
   - `low`: 256 px, sin triplanar en props.
   - `high`: 512 px, con filtrado anisotrópico y triplanar.

## Fases

### Fase 1 — Generador de texturas
- Nuevo archivo `client/src/render/textures.ts` con `buildTextureSet(size)`. Dibuja en canvas a partir de `fbm` y `valueNoise` de [shared/src/terrain.ts](../shared/src/terrain.ts):
  - **Terreno:** pasto (briznas y manchas), tierra/camino (piedritas, huellas), roca (grietas, estratos), arena, nieve, empedrado del pueblo.
  - **Props:** tablones de madera, piedra/sillar, tejas, revoque.
- Las texturas son en escala de grises más un toque de detalle. El tono lo sigue poniendo el color actual (vertex color o `mat(color)`) y la textura modula la luminancia. Así se conserva la paleta de cada zona.
- Las capas del terreno se empaquetan en un único `DataArrayTexture`: un solo sampler, con mipmaps y `RepeatWrapping`.
- Tiene que ser repetible sin costuras: el ruido se envuelve en los bordes del tile.
- Se cachea en memoria. Hay que medir cuánto tarda en generarse; el presupuesto es menos de 150 ms en high.

**Estado: hecha.** Lo que quedó, y en qué cambió respecto de lo planeado:

- **Archivos.**
  - [texgen.ts](../client/src/render/texgen.ts): genera los texels, sin three.js. Usa su propio ruido periódico (value noise, fbm, ridged y Worley), porque el de `shared/terrain.ts` no se repite sin costuras.
  - [texgen.worker.ts](../client/src/render/texgen.worker.ts): corre la generación en un Web Worker.
  - [textures.ts](../client/src/render/textures.ts): expone `getTextureSet(quality)`, arma las `DataArrayTexture` y mantiene el cache.
- **Formato del texel (RGBA8).**
  - R: factor de brillo; 0,5 es neutro y el shader lo usa como `R*2`.
  - G: altura, para la mezcla de capas de la Fase 2.
  - B: variación de tinte.
- **Capas.** Terreno: pasto, tierra, roca, arena, nieve y empedrado. Props: madera, piedra, tejas y revoque. Todas se verificaron en mosaico 2×2 y no muestran costuras.
- **Tamaños.** En high, el terreno va a 512 px y los props a 256 px. En low, el terreno va a 256 px y los props a 128 px.
- **Memoria de GPU** (mipmaps incluidos): 9,3 MB en high y 2,3 MB en low. Queda dentro del presupuesto de 16 MB.
- **Tiempo de generación.** El presupuesto de 150 ms no se puede cumplir generando 2,6 M de texels en JS:

  | | Primera vez | Desde la segunda carga |
  |---|---|---|
  | high | ~1,1 s | ~50 ms |
  | low | ~0,3–0,5 s | ~50 ms |

  Por eso el presupuesto pasa a ser este:
  - **0 ms de bloqueo del hilo principal**, porque se genera en el worker.
  - **Caché persistente en IndexedDB.** La clave lleva `TEX_VERSION` y las versiones viejas se borran al abrir la base. Si IndexedDB o el worker no están disponibles, se genera de nuevo o en el hilo principal.
  - **En la Fase 2**, el terreno se muestra con los colores actuales hasta que llegan las texturas.

### Fase 2 — Terreno con mezcla de capas
- Separar `groundColor` en `groundLayers(x, z, h)`, que devuelve el tinte y los pesos de cada capa. `groundColor` sigue existiendo para el minimapa ([ui/minimap.ts](../client/src/ui/minimap.ts)) como mezcla de esos mismos datos.
- En `buildTerrain`, agregar los atributos `splatA` y `splatB` (vec4 cada uno, 8 capas como máximo). El peso de roca en pendiente se pasa del oscurecido actual por normal a un peso en el atributo.
- Shader (`onBeforeCompile` sobre el `MeshLambertMaterial` del terreno):
  - Muestrea cada capa con UV = `worldPos.xz * escala`.
  - Mezcla por altura (*height blend*), así los bordes pasto/tierra quedan irregulares en vez de un fundido.
  - Para romper la repetición: mezcla dos escalas de la misma capa y aplica una variación de brillo grande desde una textura de ruido.
  - La roca se muestrea en triplanar solo donde la pendiente es fuerte.
- `flatShading` se mantiene, por el look facetado. La textura aporta el detalle dentro de cada faceta.
- Cuidado: `computeVertexNormals` se calcula por chunk, y la mezcla tiene que ser continua entre chunks. Los pesos dependen solo de `(x, z, h)`, así que coinciden en los bordes.

### Fase 3 — Pueblo y props
- Agregar `texMat(color, kind)` junto a `mat(color)`. `kind` puede ser `'wood' | 'stone' | 'roof' | 'plaster' | 'none'`, y el cache pasa a usar `color|kind` como clave.
- Asignar el tipo de material en los constructores de edificios: `house`, `gable`, `tavern`, `townHall`, `smithy`, la empalizada, las torres, los puestos y la fuente.
- Usar proyección triplanar en espacio de mundo. Funciona aunque `mergeStatic` fusione la geometría, porque no depende de UVs.
- Las texturas tienen que ser direccionales donde importa: las vetas de madera verticales en postes y horizontales en tablones. Para eso alcanza con elegir el eje dominante de la normal.

### Fase 4 — Rocas, árboles y agua
- **Rocas** (`buildRocks`, el `DodecahedronGeometry` instanciado): roca triplanar con el color de instancia como tinte.
- **Troncos:** corteza con UV cilíndrica (la geometría ya la trae).
- **Copas:** un ruido muy sutil para que no se vean como plástico. Opcional, y solo en high.
- **Agua:** sumar al `waterMaterial` un mapa de ondas animado y generado igual que el resto.
- **Pasto y flores:** sin cambios. Ya funcionan como detalle.

### Fase 5 — Opción gráfica, rendimiento y pulido
- Sumar `textures` a `Settings`, `PRESETS` y la UI de opciones. Cambiarla en caliente regenera los materiales con `needsUpdate`.
- Filtrado anisotrópico según `renderer.capabilities.getMaxAnisotropy()`, con tope de 4 en high.
- Revisar cómo se ven las texturas de noche, con la gradación de color (`post.ts`) y con niebla.
- Presupuestos a validar:
  - Como mucho 1 sampler extra en terreno y 1 en props.
  - Menos de 16 MB de memoria de GPU en texturas.
  - Una caída de FPS menor al 10 % frente a `textures: off`, medida con `client/src/bench.ts`.

## Archivos clave

| Archivo | Cambio |
|---|---|
| `client/src/render/textures.ts` (nuevo) | Generación procedural, `DataArrayTexture`, cache |
| `client/src/render/scene.ts` | `groundLayers`, atributos de pesos, shader del terreno, `texMat` en edificios y rocas |
| `client/src/render/atmos.ts` | Reutilizar el patrón `onBeforeCompile` y sumar ondas al agua |
| `client/src/settings.ts` | Opción `textures` y presets |
| `client/src/ui/*` (opciones) | Selector de calidad de texturas |
| `client/src/ui/minimap.ts` | Sin cambio funcional (sigue usando `groundColor`) |

El servidor y `shared/` no cambian, salvo que haga falta exponer algún helper de ruido.

## Riesgos

- **Repetición visible** en zonas grandes de pasto. Se mitiga con la mezcla de dos escalas y la variación de brillo.
- **Costo en móviles** de varias lecturas de textura con triplanar. Se mitiga con `low` (sin triplanar y una sola escala) y `off` por defecto en el preset low.
- **Conflictos de `onBeforeCompile`** si un material ya lo usa, como `sway`. Hay que encadenar los hooks y fijar `customProgramCacheKey`.
- **Que el estilo deje de ser low-poly.** Mantener texturas de bajo contraste y que el color de cada zona siga dominando.

## Verificación

1. `npm run typecheck`.
2. `npm run dev` más el servidor (`npm run dev:rs` o Docker), y recorrer el pueblo y las 4 zonas en `textures` off, low y high:
   - Que no haya costuras entre chunks.
   - Que los caminos y la orilla de las lagunas se vean bien.
   - Que los edificios fusionados queden texturizados sin estirarse.
3. De noche y de día, con cada "look" de post-procesado.
4. Con `bench.ts`: medir los FPS de off contra high en el pueblo y en Cursed Wastes, y verificar los presupuestos de la Fase 5.
5. Celular (o viewport mobile del navegador): que el preset por defecto no active texturas pesadas.
