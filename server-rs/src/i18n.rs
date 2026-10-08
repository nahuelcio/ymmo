//! Bilingual text: Argentine Spanish (the data's language) and English.
use crate::data::d;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang { Es, En }

impl Lang {
    pub fn parse(s: &str) -> Option<Lang> {
        match s { "es" => Some(Lang::Es), "en" => Some(Lang::En), _ => None }
    }
    pub fn en(self) -> bool { self == Lang::En }
}

/** tr(lang, "castellano", "english") */
pub fn tr<'a>(l: Lang, es: &'a str, en: &'a str) -> &'a str { if l.en() { en } else { es } }
pub fn trs(l: Lang, es: String, en: String) -> String { if l.en() { en } else { es } }

pub fn item_name(id: &str, l: Lang) -> String {
    d().item(id).map(|i| if l.en() { i.name_en.clone() } else { i.name.clone() }).unwrap_or_else(|| id.to_string())
}
pub fn teleport_name(id: &str, l: Lang) -> String {
    d().teleports.iter().find(|t| t.id == id).map(|t| if l.en() { t.name_en.clone() } else { t.name.clone() }).unwrap_or_else(|| id.to_string())
}
pub fn npc_title(id: &str, l: Lang) -> String {
    d().npc(id).map(|n| if l.en() { n.title_en.clone() } else { n.title.clone() }).unwrap_or_default()
}
pub fn npc_greeting(id: &str, l: Lang) -> String {
    d().npc(id).map(|n| if l.en() { n.greeting_en.clone() } else { n.greeting.clone() }).unwrap_or_default()
}
pub fn npc_lines(id: &str, l: Lang) -> &'static [String] {
    match d().npc(id) { Some(n) => if l.en() { &n.lines_en } else { &n.lines }, None => &[] }
}
pub fn zone_name(es: &str, l: Lang) -> String {
    if !l.en() { return es.to_string(); }
    let data = d();
    if let Some(t) = data.towns.iter().find(|t| t.name == es) { return t.name_en.clone(); }
    if es == data.wild.name { return data.wild.name_en.clone(); }
    if let Some(z) = data.zones.iter().find(|z| z.name == es) { return z.name_en.clone(); }
    if let Some(r) = data.raids.values().find(|r| r.name == es) { return r.name_en.clone(); }
    es.to_string()
}

/** "1.234" (es) / "1,234" (en) */
pub fn fmt_int(n: i64, l: Lang) -> String {
    let s = n.abs().to_string();
    let sep = if l.en() { ',' } else { '.' };
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 { out.push(sep); }
        out.push(c);
    }
    if n < 0 { format!("-{out}") } else { out }
}
