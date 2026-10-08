// Paints texture layers off the main thread (see texgen.ts).
import { paintLayers, type LayerName } from './texgen';

self.onmessage = (e: MessageEvent<{ id: number; layers: LayerName[]; size: number }>) => {
  const { id, layers, size } = e.data;
  const data = paintLayers(layers, size);
  (self as unknown as Worker).postMessage({ id, data }, [data.buffer]);
};
