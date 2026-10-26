//! World nodes: felling trees, mining rocks, picking berries, sitting and resting in tents and huts (shared/src/nodes.ts).
//! Node ids, places and rules come from game.json; which nodes are spent lives here, per world.
use crate::collision::approach_point;
use crate::data::{d, NodeKind};
use crate::ent::*;
use crate::formulas::rnd;
use crate::inventory::add_item;
use crate::player::IN_COMBAT_MS;
use crate::world::World;
use serde_json::json;

/** How far beyond a node's body radius a character works it (shared reachOf). */
const NODE_REACH: f64 = 0.9;
/** How much farther than reach a walk that can't get any closer (blocked grid) still counts as arrived (m). */
const STALL_SLACK: f64 = 1.5;

impl World {
    /** 'interact': validate, then walk there (Intent::Interact) and use the node on arrival. */
    pub fn request_interact(&mut self, pid: u32, node: u32, now: f64) {
        if self.raid.is_some() || self.ents[&pid].c.dead { return; }
        let Some(n) = d().nodes.get(&node) else { return };
        if self.nodes_gone.get(&node).map_or(false, |&u| u > now) {
            return self.sys(pid, "Acá no queda nada por ahora.", "There is nothing left here for now.");
        }
        if n.kind.is_rest() {
            if let Some((es, en)) = self.rest_refused(pid, node, now) { return self.sys(pid, es, en); }
        } else if let Err((es, en)) = self.tool_ok(pid, n.kind) {
            return self.sys(pid, es, en);
        }
        self.idle_interrupt(pid);
        // walking off to work, or to a seat, cancels a cast: it costs what Esc does
        self.stop_cast(pid, true, now);
        let p = self.pl_mut(pid).unwrap();
        p.talking_to = None;
        p.intent = Some(Intent::Interact { node });
    }

    /** The weapon in hand works as this node's tool (bushes need none). */
    fn tool_ok(&self, pid: u32, kind: NodeKind) -> Result<(), (&'static str, &'static str)> {
        let Some(tools) = d().gather_def(kind).and_then(|g| g.tools.as_ref()) else { return Ok(()) };
        let wt = self.pl(pid).and_then(|p| p.equipped_in("weapon")).and_then(|i| d().item(&i.i)).and_then(|it| it.weapon_type.as_ref());
        if wt.map_or(false, |w| tools.contains(w)) { return Ok(()); }
        Err(match kind {
            NodeKind::Tree => ("Necesitás un hacha equipada para talar.", "You need an axe equipped to fell trees."),
            _ => ("Necesitás un pico o un martillo equipado para picar.", "You need a pickaxe or a hammer equipped to mine."),
        })
    }

    /** Intent::Interact, every tick: walk up to the node, then sit or start working it. */
    pub fn process_interact(&mut self, pid: u32, node: u32, speed: f64, dt: f64, now: f64) {
        let Some(n) = d().nodes.get(&node) else {
            self.pl_mut(pid).unwrap().intent = None;
            return;
        };
        let reach = if n.kind.is_rest() { 0.3 } else { n.r + NODE_REACH };
        let (px, pz) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        let arrived = if n.kind.is_rest() {
            self.step_toward(pid, n.x, n.z, speed, dt, reach)
        } else if (px - n.x).hypot(pz - n.z) <= reach {
            self.step_toward(pid, px, pz, speed, dt, 0.0) // already there: stop
        } else {
            // A tree or rock stands inside its own obstacle, where a path can never end: walking at its centre left
            // the path at whatever free cell the search found first, sometimes out of reach, and the player stood
            // there forever. Walk to a free spot within reach instead.
            let Some(a) = approach_point(n.x, n.z, reach - 0.05, px, pz) else {
                self.pl_mut(pid).unwrap().intent = None;
                return self.sys(pid, "No llegás hasta ahí.", "You can't get there.");
            };
            self.step_toward(pid, a.x, a.z, speed, dt, 0.02)
        };
        if !arrived {
            // step_toward stops walking (moving = false) when it can't get any closer: near enough counts, else give up
            let c = &self.ents[&pid].c;
            if c.moving { return; }
            if n.kind.is_rest() || (c.x - n.x).hypot(c.z - n.z) > reach + STALL_SLACK {
                self.pl_mut(pid).unwrap().intent = None;
                return self.sys(pid, "No llegás hasta ahí.", "You can't get there.");
            }
        }
        self.pl_mut(pid).unwrap().intent = None;
        let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        if d().is_deep(x, z) { return self.sys(pid, "No podés hacer eso nadando.", "You cannot do that while swimming."); }
        if n.kind.is_rest() { self.sit(pid, Some(node)) } else { self.start_gather(pid, node, now) }
    }

    fn start_gather(&mut self, pid: u32, node: u32, now: f64) {
        let n = &d().nodes[&node];
        // checked again: someone may have emptied it, or the weapon changed, on the way
        if self.nodes_gone.get(&node).map_or(false, |&u| u > now) { return self.sys(pid, "Alguien se te adelantó.", "Someone beat you to it."); }
        if let Err((es, en)) = self.tool_ok(pid, n.kind) { return self.sys(pid, es, en); }
        let g = d().gather_def(n.kind).unwrap();
        let ms = g.swing_ms * g.swings;
        let e = self.ents.get_mut(&pid).unwrap();
        e.c.moving = false;
        e.c.ry = (n.x - e.c.x).atan2(n.z - e.c.z);
        let (x, z) = (e.c.x, e.c.z);
        e.player_mut().unwrap().gather = Some((node, now, now + ms));
        self.send_near(x, z, json!({ "t": "gather", "s": pid, "node": node, "ms": ms }));
    }

    /** A gather in progress: true while it runs (the player does nothing else), finishes it when due. */
    pub fn tick_gather(&mut self, pid: u32, now: f64) -> bool {
        let Some((node, _, end)) = self.pl(pid).and_then(|p| p.gather) else { return false };
        if now < end { return true; }
        self.pl_mut(pid).unwrap().gather = None;
        if self.nodes_gone.get(&node).map_or(false, |&u| u > now) {
            self.sys(pid, "Alguien se te adelantó.", "Someone beat you to it.");
            return false;
        }
        let n = &d().nodes[&node];
        let g = d().gather_def(n.kind).unwrap();
        let (mut got_es, mut got_en, mut full) = (vec![], vec![], false);
        let p = self.pl_mut(pid).unwrap();
        for y in &g.yields {
            if y.zones.as_ref().map_or(false, |zs| !zs.contains(&n.zone)) || rnd() >= y.chance { continue; }
            let count = y.min + (rnd() * (y.max - y.min + 1) as f64).floor() as i64;
            let Some(def) = d().item(&y.item) else { continue };
            if !add_item(p, &y.item, count) {
                full = true;
                continue;
            }
            let q = if count > 1 { format!("{count} × ") } else { String::new() };
            got_es.push(format!("{q}{}", def.name));
            got_en.push(format!("{q}{}", def.name_en));
        }
        if full && got_es.is_empty() {
            // nothing taken: the node stays for when there is room
            self.sys(pid, "Tenés el inventario lleno.", "Your inventory is full.");
            return false;
        }
        self.sys(pid, &format!("Obtuviste {}.", got_es.join(", ")), &format!("You got {}.", got_en.join(", ")));
        if full { self.sys(pid, "Tenés el inventario lleno.", "Your inventory is full."); }
        self.nodes_gone.insert(node, now + g.respawn_ms);
        self.broadcast(json!({ "t": "node", "id": node, "ms": g.respawn_ms }));
        false
    }

    /** Bring back nodes whose time is up (called about once a second). */
    pub fn tick_nodes(&mut self, now: f64) {
        if self.nodes_gone.is_empty() { return; }
        let back: Vec<u32> = self.nodes_gone.iter().filter(|(_, &u)| u <= now).map(|(&id, _)| id).collect();
        for id in back {
            self.nodes_gone.remove(&id);
            self.broadcast(json!({ "t": "node", "id": id, "ms": 0 }));
        }
    }

    /** The spent nodes, for a player entering this world. */
    pub fn send_nodes(&self, pid: u32, now: f64) {
        if self.raid.is_some() { return; }
        let gone: Vec<(u32, f64)> = self.nodes_gone.iter().filter(|(_, &u)| u > now).map(|(&id, &u)| (id, (u - now).round())).collect();
        self.send(pid, json!({ "t": "nodes", "gone": gone }));
    }

    /** Why this player can't sit or rest at this node now, if they can't: a seat or tent holds one, a hut HUT_CAP, and
     * nobody walks into a hut's safety mid-fight. */
    fn rest_refused(&self, pid: u32, node: u32, now: f64) -> Option<(&'static str, &'static str)> {
        let n = &d().nodes[&node];
        // a siege is fought out in the open: no hut's safety, no tent's rest in its zone
        if matches!(n.kind, NodeKind::Hut | NodeKind::Tent) && crate::siege::besieged_at(n.x, n.z).is_some() {
            return Some(("No podés descansar acá durante el asedio.", "You cannot rest here during the siege."));
        }
        match n.kind {
            NodeKind::Hut => {
                if self.pl(pid).map_or(false, |p| now - p.last_combat < IN_COMBAT_MS) {
                    return Some(("No podés entrar a la cabaña en pleno combate.", "You cannot go into the hut in the middle of a fight."));
                }
                let inside = self.near_players(n.x, n.z, 1.0).into_iter().filter(|&id| id != pid && self.pl(id).is_some_and(|p| p.sitting == Some(node))).count();
                (inside >= d().c.hut_cap).then_some(("La cabaña está llena.", "The hut is full."))
            }
            _ if self.seats.get(&node).map_or(false, |&o| o != pid) => Some(if n.kind == NodeKind::Tent {
                ("Esa carpa está ocupada.", "That tent is taken.")
            } else {
                ("Ese lugar está ocupado.", "That seat is taken.")
            }),
            _ => None,
        }
    }

    /** Sit on a seat node, rest in a tent or a hut (at its door, inside as the clients draw it), or sit on the ground
     * (None). */
    pub fn sit(&mut self, pid: u32, seat: Option<u32>) {
        let e = &self.ents[&pid];
        if e.c.dead || e.player().map_or(true, |p| p.sitting.is_some()) { return; }
        if d().is_deep(e.c.x, e.c.z) { return self.sys(pid, "No podés sentarte en el agua.", "You cannot sit in the water."); }
        if let Some(s) = seat {
            let n = &d().nodes[&s];
            if let Some((es, en)) = self.rest_refused(pid, s, self.now) { return self.sys(pid, es, en); }
            self.set_pos(pid, n.x, n.z);
            self.ents.get_mut(&pid).unwrap().c.ry = n.ry;
            // a hut counts who sits in it (rest_refused); a seat or tent keeps its one in `seats`
            if n.kind != NodeKind::Hut { self.seats.insert(s, pid); }
            match n.kind {
                NodeKind::Tent => self.sys(pid, "Descansás en la carpa: recuperás vida y maná más rápido.", "You rest in the tent: health and mana come back faster."),
                NodeKind::Hut => self.sys(pid, "Entrás a la cabaña: recuperás vida y maná el doble que en una carpa, y nadie puede atacarte.", "You go into the hut: health and mana come back twice as fast as in a tent, and nobody can attack you."),
                _ => {}
            }
        }
        // sitting down cancels a cast: it costs what Esc does
        let now = self.now;
        self.stop_cast(pid, true, now);
        let e = self.ents.get_mut(&pid).unwrap();
        e.c.moving = false;
        let p = e.player_mut().unwrap();
        p.intent = None;
        p.sitting = Some(seat.unwrap_or(0));
    }

    pub fn stand_up(&mut self, pid: u32) {
        let until = self.now + d().c.stand_up_ms;
        let Some(p) = self.pl_mut(pid) else { return };
        let Some(s) = p.sitting.take() else { return };
        p.stand_until = until; // the get-up clip plays before anything else happens
        if s != 0 && self.seats.get(&s) == Some(&pid) { self.seats.remove(&s); }
    }

    /** /sit and the 'sit' message: sit on the ground, or get up. */
    pub fn toggle_sit(&mut self, pid: u32) {
        if self.pl(pid).map_or(false, |p| p.sitting.is_some()) { return self.stand_up(pid); }
        if self.pl(pid).map_or(false, |p| p.gather.is_some()) { return; }
        self.sit(pid, None);
    }

    /** Any action (moving, fighting, talking...) gets a sitting player up and drops a gather. */
    pub fn idle_interrupt(&mut self, pid: u32) {
        self.stand_up(pid);
        if let Some(p) = self.pl_mut(pid) { p.gather = None; }
    }
}
