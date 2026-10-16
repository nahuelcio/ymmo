# shared/src/nodes.ts

- NodeKind · type · L6-L6 — type NodeKind = 'tree' | 'rock' | 'bush' | 'seat';
- NodeDef · interface · L11-L24 — interface NodeDef
- Yield · interface · L27-L27 — interface Yield
- GatherDef · interface · L29-L39 — interface GatherDef
- allNodes · function · L61-L73 — function allNodes(): NodeDef[]
- nodeById · function · L75-L78 — function nodeById(id: number): NodeDef | undefined
- nodeIndex · function · L81-L81 — nodeIndex = (n: NodeDef)
- hkey · function · L86-L86 — hkey = (cx: number, cz: number)
- nodesNear · function · L89-L107 — function nodesNear(x: number, z: number, r: number): NodeDef[]
- reachOf · function · L113-L113 — reachOf = (n: NodeDef)
