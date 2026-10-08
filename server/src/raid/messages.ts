// Messages between the main thread (sockets, overworld) and a raid worker (one instance).
import type { C2S } from '../../../shared/src/protocol';
import type { Lang } from '../../../shared/src/i18n';

export type ToWorker =
  | { k: 'join'; sid: number; accountId: number; charId: number; lang: Lang }
  | { k: 'msg'; sid: number; m: C2S }
  /** the socket closed: save and drop the player */
  | { k: 'quit'; sid: number }
  | { k: 'lang'; sid: number; lang: Lang };

export type FromWorker =
  /** a JSON message for the client, already serialized */
  | { k: 'out'; sid: number; j: string }
  | { k: 'bin'; sid: number; b: Uint8Array }
  /** player saved and gone back to the overworld */
  | { k: 'left'; sid: number }
  /** player saved after a quit */
  | { k: 'closed'; sid: number }
  | { k: 'joinFail'; sid: number }
  /** nobody left inside: the instance can be terminated */
  | { k: 'empty' }
  | { k: 'perf'; tick: number; players: number };

export interface RaidWorkerData {
  raidId: string;
  size: number;
}
