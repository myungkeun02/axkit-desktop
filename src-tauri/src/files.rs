//! Files the assistant sends (§19: pdf, office, hwp, txt, zip — up to 20MB, kept 24h on the Mac).
//! The owner clicks a file row → we fetch `files/<id>` with the token, save it to ~/Downloads and show it with
//! Quick Look (preview only, nothing runs). Preview and "show in Finder" work only on files saved here.

use std::path::{Path, PathBuf};

/// A safe file name: no folders, no leading dot, no control characters, at most 120 characters.
pub fn safe_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base.chars().filter(|c| !c.is_control() && !matches!(c, ':' | '/' | '\\')).collect();
    let trimmed = cleaned.trim().trim_start_matches('.').trim();
    let mut out: String = trimmed.chars().take(120).collect();
    if out.is_empty() {
        out = "파일".to_string();
    }
    out
}

/// `name`, or `name (1)`, `name (2)` … before the extension, whichever is free in `dir`.
pub fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (1..1000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

pub fn downloads_dir() -> Option<PathBuf> {
    dirs::download_dir().or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_stay_inside_the_folder() {
        assert_eq!(safe_name("견적서_11월.pdf"), "견적서_11월.pdf");
        assert_eq!(safe_name("../../.ssh/id_rsa"), "id_rsa");
        assert_eq!(safe_name(".hidden"), "hidden");
        assert_eq!(safe_name("a\u{0}b:c.txt"), "abc.txt");
        assert_eq!(safe_name(""), "파일");
    }

    #[test]
    fn never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.pdf"), b"x").unwrap();
        std::fs::write(dir.path().join("a (1).pdf"), b"x").unwrap();
        assert_eq!(free_path(dir.path(), "a.pdf").file_name().unwrap(), "a (2).pdf");
        assert_eq!(free_path(dir.path(), "b").file_name().unwrap(), "b");
    }
}
