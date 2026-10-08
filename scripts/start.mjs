// Starts the game server: the Rust build if it exists (npm run build:rs), else the Node one.
// Force one with GAME_SERVER=rust|node.
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const bin = 'server-rs/target/release/claudi-server';
const want = process.env.GAME_SERVER ?? (existsSync(bin) ? 'rust' : 'node');
const [cmd, args] = want === 'rust' ? [bin, []] : ['npx', ['tsx', 'server/src/index.ts']];
console.log(`[start] ${want} server`);
const child = spawn(cmd, args, { stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
