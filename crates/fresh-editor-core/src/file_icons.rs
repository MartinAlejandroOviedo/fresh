//! The icon in front of a folder or a file name.
//!
//! Shared by every surface that lists entries by name — today the file-open
//! browser dialog — so the same file reads the same way wherever it shows up.
//! The left file explorer does **not** come through here: plugins drive its
//! leading slot through `FileExplorerSlotEntry`, so the `file_icons` plugin
//! keeps its own copy of this table in TypeScript. When one changes, change
//! both, or the two surfaces will disagree about the same file.
//!
//! Glyphs are plain emoji, not private-use-area codepoints from a Nerd Font.
//! PUA has no font fallback: on a stock Windows console those codepoints render
//! as empty boxes, which is the same reason `view/settings/render.rs` keeps a
//! separate non-Nerd set. Every glyph below is one that Windows resolves
//! through `seguisym.ttf`, so nothing here depends on a patched font being
//! installed.
//!
//! Lookup is a linear scan over small static tables, the same shape
//! `language_detect` uses. It runs once per visible row per frame, over
//! strings that differ in their first byte, which is cheaper than the hashing a
//! map would cost to build for a table this size.

/// One glyph and the colour it is painted in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileMark {
    /// The glyph, exactly two columns wide for every entry in the tables below
    /// except the two that are single-width by Unicode's definition.
    pub icon: &'static str,
    pub rgb: (u8, u8, u8),
}

const fn mark(icon: &'static str, rgb: (u8, u8, u8)) -> FileMark {
    FileMark { icon, rgb }
}

// ── Glyphs ──────────────────────────────────────────────────────────────

const FOLDER: &str = "\u{1F4C1}"; // 📁
const OPEN_FOLDER: &str = "\u{1F4C2}"; // 📂
const CARD_BOX: &str = "\u{1F5C3}"; // 🗃️
const PACKAGE: &str = "\u{1F4E6}"; // 📦
const CRANE: &str = "\u{1F3D7}"; // 🏗️
const MICROSCOPE: &str = "\u{1F52C}"; // 🔬
const BOOKS: &str = "\u{1F4DA}"; // 📚
const PALETTE: &str = "\u{1F3A8}"; // 🎨
const IMAGE: &str = "\u{1F5BC}"; // 🖼️
const WRENCH: &str = "\u{1F527}"; // 🔧
const GEAR: &str = "\u{2699}"; // ⚙
const GLOBE: &str = "\u{1F310}"; // 🌐
const MONITOR: &str = "\u{1F5A5}"; // 🖥️
const OCTOPUS: &str = "\u{1F419}"; // 🐙
const NOTE: &str = "\u{1F4DD}"; // 📝
const LOCK: &str = "\u{1F512}"; // 🔒
const KEY: &str = "\u{1F511}"; // 🔑
const WHALE: &str = "\u{1F433}"; // 🐳
const FILE: &str = "\u{1F4C4}"; // 📄
const BOMB: &str = "\u{1F4A3}"; // 💣

const SQ_BLUE: &str = "\u{1F7E6}"; // 🟦
const SQ_GREEN: &str = "\u{1F7E7}"; // 🟩
const SQ_YELLOW: &str = "\u{1F7E8}"; // 🟨
const SQ_ORANGE: &str = "\u{1F7E9}"; // 🟧
const SQ_RED: &str = "\u{1F7E5}"; // 🟥
const SQ_PURPLE: &str = "\u{1F7EA}"; // 🟪
const SQ_BLACK: &str = "\u{2B1B}"; // ⬛

// ── Colours ─────────────────────────────────────────────────────────────
//
// Literal RGB rather than theme keys: a key that fails to resolve falls back to
// the surface's ordinary ink, which would leave every icon the same neutral
// grey — the one outcome this whole thing exists to avoid.

const C_DIR: (u8, u8, u8) = (124, 168, 255);
const C_SRC: (u8, u8, u8) = (126, 214, 160);
const C_VENDOR: (u8, u8, u8) = (192, 148, 255);
const C_BUILD: (u8, u8, u8) = (224, 168, 83);
const C_TEST: (u8, u8, u8) = (115, 214, 176);
const C_DOCS: (u8, u8, u8) = (125, 207, 255);
const C_ASSET: (u8, u8, u8) = (255, 158, 100);
const C_TOOL: (u8, u8, u8) = (255, 121, 198);
const C_META: (u8, u8, u8) = (229, 192, 123);
const C_SECRET: (u8, u8, u8) = (230, 190, 120);
const C_PLAIN: (u8, u8, u8) = (176, 190, 210);

const FOLDER_MARK: FileMark = mark(FOLDER, C_DIR);
const FILE_MARK: FileMark = mark(FILE, C_PLAIN);

// ── Tables ─────────────────────────────────────────────────────────────

/// Directories whose *name* identifies them, regardless of contents.
const FOLDER_MARKS: &[(&str, FileMark)] = &[
    ("src", mark(OPEN_FOLDER, C_SRC)),
    ("source", mark(OPEN_FOLDER, C_SRC)),
    ("lib", mark(OPEN_FOLDER, C_SRC)),
    ("app", mark(OPEN_FOLDER, C_SRC)),
    ("apps", mark(OPEN_FOLDER, C_SRC)),
    ("packages", mark(PACKAGE, C_SRC)),
    ("components", mark(OPEN_FOLDER, C_SRC)),
    ("node_modules", mark(PACKAGE, C_VENDOR)),
    ("vendor", mark(PACKAGE, C_VENDOR)),
    ("venv", mark(PACKAGE, C_VENDOR)),
    (".venv", mark(PACKAGE, C_VENDOR)),
    ("site_packages", mark(PACKAGE, C_VENDOR)),
    ("dist", mark(CRANE, C_BUILD)),
    ("build", mark(CRANE, C_BUILD)),
    ("out", mark(CRANE, C_BUILD)),
    ("target", mark(CRANE, C_BUILD)),
    ("coverage", mark(CRANE, C_BUILD)),
    ("next", mark(CRANE, C_BUILD)),
    (".next", mark(CRANE, C_BUILD)),
    ("test", mark(MICROSCOPE, C_TEST)),
    ("tests", mark(MICROSCOPE, C_TEST)),
    ("spec", mark(MICROSCOPE, C_TEST)),
    ("specs", mark(MICROSCOPE, C_TEST)),
    ("__tests__", mark(MICROSCOPE, C_TEST)),
    ("e2e", mark(MICROSCOPE, C_TEST)),
    ("docs", mark(BOOKS, C_DOCS)),
    ("doc", mark(BOOKS, C_DOCS)),
    ("examples", mark(BOOKS, C_DOCS)),
    ("assets", mark(PALETTE, C_ASSET)),
    ("static", mark(PALETTE, C_ASSET)),
    ("public", mark(GLOBE, C_ASSET)),
    ("images", mark(IMAGE, C_ASSET)),
    ("img", mark(IMAGE, C_ASSET)),
    ("icons", mark(IMAGE, C_ASSET)),
    ("scripts", mark(WRENCH, C_TOOL)),
    ("tools", mark(WRENCH, C_TOOL)),
    ("bin", mark(MONITOR, C_TOOL)),
    ("config", mark(GEAR, C_TOOL)),
    ("configs", mark(GEAR, C_TOOL)),
    (".git", mark(CARD_BOX, C_META)),
    ("logs", mark(CARD_BOX, C_META)),
    (".github", mark(OCTOPUS, C_META)),
    (".vscode", mark(MONITOR, C_META)),
    (".idea", mark(MONITOR, C_META)),
];

/// Files whose *whole name* identifies them — either because the name is the
/// format (`Dockerfile`) or because the extension says nothing (`Cargo.lock`).
const FILE_NAME_MARKS: &[(&str, FileMark)] = &[
    ("dockerfile", mark(WHALE, (70, 160, 220))),
    ("makefile", mark(WRENCH, (150, 200, 120))),
    ("justfile", mark(WRENCH, (150, 200, 120))),
    ("cargo.toml", mark(SQ_ORANGE, (230, 150, 90))),
    ("cargo.lock", mark(LOCK, (190, 190, 200))),
    ("go.mod", mark(SQ_BLUE, (78, 201, 176))),
    ("go.sum", mark(SQ_BLUE, (78, 201, 176))),
    ("package.json", mark(SQ_YELLOW, (240, 219, 79))),
    ("package-lock.json", mark(LOCK, (190, 190, 200))),
    ("pnpm-lock.yaml", mark(LOCK, (190, 190, 200))),
    ("yarn.lock", mark(LOCK, (190, 190, 200))),
    ("tsconfig.json", mark(SQ_BLUE, (97, 175, 239))),
    ("vite.config.ts", mark(SQ_GREEN, (190, 120, 255))),
    ("license", mark(NOTE, (200, 200, 120))),
];

/// Extensions, lowercase and without the dot.
const EXT_MARKS: &[(&str, FileMark)] = &[
    ("ts", mark(SQ_BLUE, (97, 175, 239))),
    ("tsx", mark(SQ_BLUE, (97, 175, 239))),
    ("mts", mark(SQ_BLUE, (97, 175, 239))),
    ("cts", mark(SQ_BLUE, (97, 175, 239))),
    ("dts", mark(SQ_BLUE, (97, 175, 239))),
    ("js", mark(SQ_YELLOW, (240, 219, 79))),
    ("jsx", mark(SQ_YELLOW, (240, 219, 79))),
    ("mjs", mark(SQ_YELLOW, (240, 219, 79))),
    ("cjs", mark(SQ_YELLOW, (240, 219, 79))),
    ("json", mark(SQ_YELLOW, (220, 200, 110))),
    ("jsonc", mark(SQ_YELLOW, (220, 200, 110))),
    ("json5", mark(SQ_YELLOW, (220, 200, 110))),
    ("yaml", mark(SQ_ORANGE, (155, 199, 130))),
    ("yml", mark(SQ_ORANGE, (155, 199, 130))),
    ("toml", mark(SQ_ORANGE, (155, 199, 130))),
    ("ini", mark(SQ_ORANGE, (155, 199, 130))),
    ("cfg", mark(SQ_ORANGE, (155, 199, 130))),
    ("conf", mark(SQ_ORANGE, (155, 199, 130))),
    ("env", mark(KEY, C_SECRET)),
    ("html", mark(SQ_ORANGE, (255, 138, 92))),
    ("htm", mark(SQ_ORANGE, (255, 138, 92))),
    ("css", mark(SQ_BLUE, (110, 190, 255))),
    ("scss", mark(SQ_BLUE, (110, 190, 255))),
    ("sass", mark(SQ_BLUE, (110, 190, 255))),
    ("less", mark(SQ_BLUE, (110, 190, 255))),
    ("vue", mark(SQ_GREEN, (116, 222, 152))),
    ("svelte", mark(SQ_ORANGE, (255, 145, 90))),
    ("py", mark(SQ_GREEN, (129, 199, 212))),
    ("rb", mark(SQ_RED, (255, 95, 95))),
    ("rs", mark(SQ_ORANGE, (222, 170, 108))),
    ("go", mark(SQ_GREEN, (78, 201, 176))),
    ("java", mark(SQ_RED, (240, 110, 120))),
    ("kt", mark(SQ_PURPLE, (190, 130, 255))),
    ("c", mark(SQ_BLUE, (140, 180, 255))),
    ("h", mark(SQ_BLUE, (140, 180, 255))),
    ("cpp", mark(SQ_BLUE, (130, 160, 255))),
    ("hpp", mark(SQ_BLUE, (130, 160, 255))),
    ("cs", mark(SQ_GREEN, (120, 200, 140))),
    ("php", mark(SQ_BLUE, (140, 160, 230))),
    ("sh", mark(SQ_GREEN, (120, 200, 140))),
    ("bash", mark(SQ_GREEN, (120, 200, 140))),
    ("zsh", mark(SQ_GREEN, (120, 200, 140))),
    ("fish", mark(SQ_GREEN, (120, 200, 140))),
    ("ps1", mark(SQ_BLUE, (70, 150, 220))),
    ("bat", mark(SQ_BLUE, (70, 150, 220))),
    ("cmd", mark(SQ_BLUE, (70, 150, 220))),
    ("lua", mark(SQ_BLUE, (120, 150, 230))),
    ("pl", mark(SQ_BLUE, (140, 130, 220))),
    ("pm", mark(SQ_BLUE, (130, 170, 230))),
    ("sql", mark(SQ_ORANGE, (220, 160, 100))),
    ("db", mark(SQ_ORANGE, (220, 160, 100))),
    ("sqlite", mark(SQ_ORANGE, (220, 160, 100))),
    ("csv", mark(SQ_GREEN, (140, 200, 130))),
    ("md", mark(NOTE, (190, 200, 220))),
    ("mdx", mark(NOTE, (190, 200, 220))),
    ("txt", mark(NOTE, (170, 180, 200))),
    ("rst", mark(NOTE, (170, 180, 200))),
    ("pdf", mark(FILE, (200, 120, 130))),
    ("png", mark(IMAGE, (150, 200, 255))),
    ("jpg", mark(IMAGE, (150, 200, 255))),
    ("jpeg", mark(IMAGE, (150, 200, 255))),
    ("gif", mark(IMAGE, (150, 200, 255))),
    ("webp", mark(IMAGE, (150, 200, 255))),
    ("svg", mark(IMAGE, (150, 200, 255))),
    ("ico", mark(IMAGE, (150, 200, 255))),
    ("woff", mark(SQ_BLACK, C_PLAIN)),
    ("woff2", mark(SQ_BLACK, C_PLAIN)),
    ("ttf", mark(SQ_BLACK, C_PLAIN)),
    ("otf", mark(SQ_BLACK, C_PLAIN)),
    ("lock", mark(LOCK, (190, 190, 200))),
    ("dockerfile", mark(WHALE, (70, 160, 220))),
    ("makefile", mark(WRENCH, (150, 200, 120))),
    ("gradle", mark(OCTOPUS, (120, 200, 220))),
    ("gitignore", mark(GEAR, (220, 140, 130))),
    ("gitattributes", mark(GEAR, (220, 140, 130))),
    ("gitmodules", mark(GEAR, (220, 140, 130))),
    ("editorconfig", mark(GEAR, (220, 140, 130))),
];

fn lookup<'t>(table: &'t [(&'static str, FileMark)], key: &str) -> Option<&'t FileMark> {
    table
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, m)| m)
}

/// The icon and colour for `name`.
///
/// Matching is case-insensitive throughout: Windows and macOS both hand back
/// whatever case the directory happens to hold, and `README.md` must not read
/// differently from `readme.md`.
pub fn mark_for(name: &str, is_dir: bool) -> FileMark {
    let lower = name.to_lowercase();

    if is_dir {
        return lookup(FOLDER_MARKS, &lower).copied().unwrap_or(FOLDER_MARK);
    }

    if let Some(found) = lookup(FILE_NAME_MARKS, &lower) {
        return *found;
    }

    if let Some(dot) = lower.rfind('.') {
        if dot > 0 {
            if let Some(found) = lookup(EXT_MARKS, &lower[dot + 1..]) {
                return *found;
            }
        }
    }

    if let Some(found) = by_shape(&lower) {
        return found;
    }

    FILE_MARK
}

/// The rules that need the whole name rather than a table lookup: secrets,
/// leftovers, archives, and the handful of names everyone recognises.
///
/// Separate from [`mark_for`] so the tables above stay declarative and this
/// reads as the ordered list of exceptions it is.
fn by_shape(lower: &str) -> Option<FileMark> {
    // `.env`, `.env.local`, `.envrc` — the dotfile names that hold secrets.
    if lower == ".env" || lower.starts_with(".env.") || lower == ".envrc" {
        return Some(mark(KEY, C_SECRET));
    }
    if lower.ends_with(".pem")
        || lower.ends_with(".key")
        || lower.ends_with(".p12")
        || lower.ends_with(".pfx")
        || lower.ends_with(".keystore")
    {
        return Some(mark(KEY, C_SECRET));
    }
    // Editor leftovers: a backup or a conflict nobody has dealt with yet.
    for suffix in [".bak", ".tmp", ".swp", ".orig", ".rej"] {
        if lower.ends_with(suffix) {
            return Some(mark(BOMB, (200, 150, 130)));
        }
    }
    // Archives and binaries.
    for suffix in [
        ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".dmg", ".iso", ".exe", ".msi",
    ] {
        if lower.ends_with(suffix) {
            return Some(mark(PACKAGE, (210, 180, 140)));
        }
    }
    if lower.starts_with("readme") {
        return Some(mark(BOOKS, C_DOCS));
    }
    for stem in ["license", "copying", "notice"] {
        if lower == stem || lower.starts_with(&format!("{stem}.")) {
            return Some(mark(NOTE, (200, 200, 120)));
        }
    }
    for name in [".gitignore", ".gitattributes", ".gitmodules", ".gitconfig"] {
        if lower == name {
            return Some(mark(GEAR, (220, 140, 130)));
        }
    }
    if lower.starts_with("test") || lower.ends_with(".test") || lower.ends_with(".spec") {
        return Some(mark(MICROSCOPE, C_TEST));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directories_are_marked_by_name_and_fall_back_to_a_folder() {
        assert_eq!(mark_for("src", true), mark(OPEN_FOLDER, C_SRC));
        assert_eq!(mark_for("SRC", true), mark(OPEN_FOLDER, C_SRC));
        assert_eq!(mark_for("node_modules", true), mark(PACKAGE, C_VENDOR));
        assert_eq!(mark_for("anything-else", true), FOLDER_MARK);
    }

    #[test]
    fn a_directory_returns_from_the_table_and_never_the_file_rules() {
        // `docs` is in both tables, and as a directory it must come from the
        // directory one. They happen to agree today; the assertion is that the
        // file rules are unreachable for a directory at all, so a later entry
        // that disagrees fails here instead of shipping silently.
        assert_eq!(mark_for("docs", true), lookup(FOLDER_MARKS, "docs").copied().unwrap());
        assert_eq!(mark_for("build", true), mark(CRANE, C_BUILD));
        // A name only the file rules know: as a directory it is a plain folder.
        assert_eq!(mark_for("secret.pem", true), FOLDER_MARK);
    }

    #[test]
    fn extension_is_the_second_thing_tried() {
        assert_eq!(mark_for("main.rs", false), mark(SQ_ORANGE, (222, 170, 108)));
        // The name wins: `Cargo.toml` is not a generic toml file.
        assert_eq!(mark_for("Cargo.toml", false), mark(SQ_ORANGE, (230, 150, 90)));
    }

    #[test]
    fn dotfiles_have_no_extension_for_rfind_to_find() {
        // `rfind('.')` at index 0 must not be read as an empty extension.
        assert_eq!(mark_for(".gitignore", false), mark(GEAR, (220, 140, 130)));
    }

    #[test]
    fn secrets_and_leftovers_are_recognised_by_shape() {
        assert_eq!(mark_for(".env.local", false), mark(KEY, C_SECRET));
        assert_eq!(mark_for("server.pem", false), mark(KEY, C_SECRET));
        assert_eq!(mark_for("config.bak", false), mark(BOMB, (200, 150, 130)));
        assert_eq!(mark_for("bundle.zip", false), mark(PACKAGE, (210, 180, 140)));
    }

    #[test]
    fn unknown_files_get_the_plain_page() {
        assert_eq!(mark_for("mystery.qqq", false), FILE_MARK);
        assert_eq!(mark_for("noextension", false), FILE_MARK);
    }
}
