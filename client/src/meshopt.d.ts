// three ships meshoptimizer's simplifier without types: just what render/lod.ts uses.
declare module 'three/examples/jsm/libs/meshopt_simplifier.module.js' {
  export const MeshoptSimplifier: {
    ready: Promise<void>;
    simplify(
      indices: Uint32Array, positions: Float32Array, stride: number, targetIndexCount: number, targetError: number, flags?: ('LockBorder' | 'Sparse' | 'ErrorAbsolute')[],
    ): [Uint32Array, number];
  };
}
