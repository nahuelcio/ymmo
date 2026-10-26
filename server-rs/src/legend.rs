//! Legend: XP past the level cap fills a Legend bar; every Legend level is a point to spend on a passive
//! (LEGEND in shared/src/data/legend.ts; the bar's length is formulas.rs legend_to_next, the passives' sum legend_mods).
use crate::data::d;
use crate::formulas::{jround, legend_to_next};
use crate::terrain::in_town;
use crate::world::World;

impl World {
    /** XP earned at the level cap (gain_xp): the Legend's bar, a point to spend each level of it. Full, it is lost. */
    pub fn gain_legend(&mut self, pid: u32, amt: i64) {
        let cap = d().legend.max;
        let p = self.pl_mut(pid).unwrap();
        if p.legend_lvl >= cap { return; }
        p.legend_xp += amt;
        let mut ups = vec![];
        while p.legend_lvl < cap && p.legend_xp >= legend_to_next(p.legend_lvl) {
            p.legend_xp -= legend_to_next(p.legend_lvl);
            p.legend_lvl += 1;
            ups.push(p.legend_lvl);
        }
        if p.legend_lvl >= cap { p.legend_xp = 0; }
        self.sys(pid, &format!("Ganaste {amt} de experiencia de Leyenda."), &format!("You have earned {amt} Legend experience."));
        for l in ups {
            self.sys(pid, &format!("¡Subiste a Leyenda {l}! Tenés un punto para repartir en Estado del Personaje."), &format!("You reached Legend {l}! You have a point to spend in Character Status."));
        }
    }

    /** A death at the level cap: 4% of the Legend level's bar (times `mul`: a karma death costs double), never a level. */
    pub fn lose_legend(&mut self, pid: u32, mul: f64) {
        let p = self.pl_mut(pid).unwrap();
        let loss = (jround(legend_to_next(p.legend_lvl) as f64 * 0.04 * mul) as i64).min(p.legend_xp);
        if loss <= 0 { return; }
        p.legend_xp -= loss;
        self.sys(pid, &format!("Moriste y perdiste {loss} de experiencia de Leyenda."), &format!("You have died and lost {loss} Legend experience."));
    }

    /** Free Legend points: the levels reached that are not spent yet. */
    pub fn legend_free(&self, pid: u32) -> i64 {
        self.pl(pid).map_or(0, |p| p.legend_lvl - p.legend.values().sum::<i64>())
    }

    /** 'legendSpend': one more rank of a passive, for a free point. */
    pub fn legend_spend(&mut self, pid: u32, id: &str) {
        let Some(def) = d().legend.passives.iter().find(|p| p.id == id) else { return };
        if self.legend_free(pid) <= 0 { return self.sys(pid, "No tenés puntos de Leyenda para repartir.", "You have no Legend points to spend."); }
        let p = self.pl(pid).unwrap();
        let rank = p.legend.get(id).copied().unwrap_or(0);
        if rank >= def.max { return self.sys(pid, &format!("{} ya está al máximo.", def.name), &format!("{} is already maxed out.", def.name_en)); }
        let mut next = p.legend.clone();
        next.insert(id.to_string(), rank + 1);
        if !self.save_legend(pid, &next) { return; }
        let p = self.pl_mut(pid).unwrap();
        p.legend = next;
        p.recalc();
        self.sys(pid, &format!("{} sube a {}/{}.", def.name, rank + 1, def.max), &format!("{} rises to {}/{}.", def.name_en, rank + 1, def.max));
    }

    /** 'legendReset': every point spent back, for adena, in a town. */
    pub fn legend_reset(&mut self, pid: u32) {
        let p = self.pl(pid).unwrap();
        let spent: i64 = p.legend.values().sum();
        if spent <= 0 { return self.sys(pid, "No tenés puntos de Leyenda repartidos.", "You have no Legend points spent."); }
        let c = &self.ents[&pid].c;
        if !in_town(c.x, c.z) { return self.sys(pid, "Solo podés reiniciar la Leyenda en un pueblo.", "You can only reset your Legend in a town."); }
        let cost = spent * d().legend.reset_cost;
        if p.adena < cost { return self.sys(pid, &format!("Necesitás {cost} adena para reiniciar la Leyenda."), &format!("You need {cost} adena to reset your Legend.")); }
        if !self.save_legend(pid, &Default::default()) { return; }
        let p = self.pl_mut(pid).unwrap();
        p.adena -= cost;
        p.legend.clear();
        p.recalc();
        self.sys(pid, &format!("Reiniciaste la Leyenda por {cost} adena: tenés {spent} puntos para repartir."), &format!("You reset your Legend for {cost} adena: you have {spent} points to spend."));
    }

    /** The points spent, written right away (as the spec is); false, and the player told, if the write failed. */
    fn save_legend(&mut self, pid: u32, ranks: &std::collections::HashMap<String, i64>) -> bool {
        let id = self.pl(pid).unwrap().char_id;
        let json = serde_json::to_string(ranks).unwrap_or_default();
        if let Err(e) = self.db.set_legend(id, &json) {
            elog!("[world] set_legend failed: {e}");
            self.sys(pid, "No se pudo guardar. Probá de nuevo.", "Could not save. Try again.");
            return false;
        }
        true
    }
}
