# shared/src/nodes.ts

- NodeKind · type · L8-L8 — type NodeKind = 'tree' | 'rock' | 'bush' | 'seat' | 'tent';
- NodeDef · interface · L13-L26 — interface NodeDef
- Yield · interface · L29-L29 — interface Yield
- GatherDef · interface · L31-L41 — interface GatherDef
- tentCentre · function · L61-L61 — tentCentre = (n: NodeDef)
- allNodes · function · L73-L91 — function allNodes(): NodeDef[]
- nodeById · function · L94-L97 — function nodeById(id: number): NodeDef | undefined
- nodeIndex · function · L100-L100 — nodeIndex = (n: NodeDef)
- hkey · function · L105-L105 — hkey = (cx: number, cz: number)
- nodesNear · function · L108-L126 — function nodesNear(x: number, z: number, r: number): NodeDef[]
- isRest · function · L132-L132 — isRest = (k: NodeKind)
- reachOf · function · L135-L135 — reachOf = (n: NodeDef)
