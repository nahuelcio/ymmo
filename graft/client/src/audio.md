# client/src/audio.ts

- Sfx · type · L6-L8 — type Sfx = | 'hit' | 'crit' | 'miss' | 'hurt' | 'cast' | 'magic' | 'heal' | 'buff' | 'levelUp' | 'death' | 'coin' | 'pickup' | 'click' | 'warn' | 'slam' | 'dash' | 'stun' | 'dot';
- audio · function · L14-L27 — function audio(): AudioContext | null
- loop · function · L36-L41 — function loop(file: string, gain: number, dungeon: boolean)
- syncLoops · function · L45-L52 — function syncLoops()
- ambience · function · L56-L59 — function ambience(zone: string)
- tone · function · L61-L73 — function tone(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number, out: AudioNode)
- hiss · function · L75-L88 — function hiss(t0: number, dur: number, vol: number, f0: number, f1: number, q: number, out: AudioNode, type: BiquadFilterType = 'bandpass')
- play · function · L91-L169 — function play(name: Sfx, gain = 1)
