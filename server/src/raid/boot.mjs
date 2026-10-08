// Worker entry: register tsx's TypeScript loader in this thread, then start the raid worker.
import { register } from 'tsx/esm/api';

register();
await import('./worker.ts');
