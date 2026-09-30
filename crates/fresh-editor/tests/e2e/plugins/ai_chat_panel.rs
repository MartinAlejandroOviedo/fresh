//! E2E coverage for the View ▸ "Chat AI" panel toggle contributed by the
//! bundled `ai_completion` plugin.
//!
//! The View menu row is added by the plugin (`addMenuItem` with
//! `checkbox: "chat_panel"`), but the `chat_panel` state is computed
//! host-side (`Editor::is_chat_panel_visible`): the AI Chat virtual buffer
//! is open in a visible split of the active window. Keeping the state on
//! the core rather than trusting the plugin's own module variable means the
//! checkmark stays honest when the panel is removed by a route the plugin
//! didn't initiate (split close, …).
//!
//! The recipe mirrors the existing View-menu checkbox tests
//! (`menu_bar::test_view_menu_file_explorer_checkbox_syncs_on_close`):
//! checkbox unchecked → toggle on → checked → toggle off → unchecked.

#![cfg(feature = "plugins")]

use crate::common::harness::{copy_plugin, copy_plugin_lib, EditorTestHarness};
use crossterm::event::{KeyCode, KeyModifiers};
use fresh::config::{Config, PluginConfig};
use fresh::input::keybindings::Action::PluginAction;
use std::fs;

/// Whether any buffer the plugin state snapshot knows about has `name`'s
/// display name. The chat panel is a virtual buffer named "AI Chat", so
/// its presence here is the plugin-side view of "chat is open".
fn snapshot_has_buffer_named(harness: &EditorTestHarness, name: &str) -> bool {
    let Some(handle) = harness.editor().plugin_manager().state_snapshot_handle() else {
        return false;
    };
    let Ok(snapshot) = handle.read() else {
        return false;
    };
    snapshot.buffers.values().any(|b| b.name == name)
}

/// Harness rooted at a scratch working directory that contains the real
/// `ai_completion` plugin (copied from the repo) with the plugin enabled,
/// so the script's top-level body runs during harness creation. `settings`
/// is the `plugins.ai_completion.settings` JSON the plugin script sees.
fn chat_harness(settings: serde_json::Value) -> (EditorTestHarness, tempfile::TempDir) {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let working_dir = temp.path().join("work");
    fs::create_dir_all(&working_dir).unwrap();
    let plugins_dir = working_dir.join("plugins");
    fs::create_dir_all(&plugins_dir).unwrap();
    copy_plugin(&plugins_dir, "ai_completion");
    copy_plugin_lib(&plugins_dir);

    let mut config = Config::default();
    config.plugins.insert(
        "ai_completion".to_string(),
        PluginConfig {
            enabled: true,
            path: None,
            settings,
        },
    );

    let mut harness = EditorTestHarness::with_config_and_working_dir(120, 40, config, working_dir)
        .expect("harness");
    harness.editor_mut().set_clipboard_for_test(String::new());
    (harness, temp)
}

/// Round-trip harness: `autoOpenChat: false` keeps the test deterministic —
/// the test drives the toggle itself instead of relying on the `ready`
/// auto-open.
fn harness_with_ai_chat() -> (EditorTestHarness, tempfile::TempDir) {
    chat_harness(serde_json::json!({ "enabled": true, "autoOpenChat": false }))
}

/// Auto-open harness: `autoOpenChat` defaults to true, so the `ready` hook
/// should open the chat panel by itself.
fn harness_with_ai_chat_autoopen() -> (EditorTestHarness, tempfile::TempDir) {
    chat_harness(serde_json::json!({ "enabled": true }))
}

/// Wait for the plugin's top-level body to have evaluated — the registered
/// `ai_chat_toggle` command is only in the registry after the whole script
/// ran, so no handler can fire before this returns.
fn wait_for_toggle_command(h: &mut EditorTestHarness) {
    h.wait_until(|h| {
        h.editor()
            .command_registry()
            .read()
            .unwrap()
            .get_all()
            .iter()
            .any(|c| c.action == PluginAction("ai_chat_toggle".to_string()))
    })
    .unwrap();
}

/// Alt+V opens the View menu dropdown, which is where the plugin's "Chat AI"
/// row lives (anchored after "File Explorer").
fn view_menu_screen(h: &mut EditorTestHarness) -> String {
    h.send_key(KeyCode::Char('v'), KeyModifiers::ALT).unwrap();
    h.render().unwrap();
    let screen = h.screen_to_string();
    // Close the menu again so subsequent keys (Esc) aren't double-consumed
    // by a still-open dropdown.
    h.send_key(KeyCode::Esc, KeyModifiers::NONE).unwrap();
    h.render().unwrap();
    screen
}

/// Toggle the chat panel via its registered plugin action and wait for the
/// editor-side state to settle, i.e. `is_chat_panel_visible() == want`.
fn toggle_chat_panel(h: &mut EditorTestHarness, want: bool) {
    h.editor_mut()
        .dispatch_action_for_tests(PluginAction("ai_chat_toggle".to_string()));
    h.wait_until(|h| h.editor().is_chat_panel_visible() == want)
        .unwrap();
}

/// Full round-trip: menu unchecked → toggle on (prompt cancelled, panel
/// stays) → menu checked → toggle off → menu unchecked. Guards both the
/// plugin handler wiring (`ai_chat_toggle`) and the host-computed
/// `chat_panel` checkbox context.
#[test]
fn chat_ai_view_menu_toggle_roundtrip() {
    let (mut h, _tmp) = harness_with_ai_chat();
    wait_for_toggle_command(&mut h);

    // Before anything: no chat buffer anywhere, host state off.
    assert!(!h.editor().is_chat_panel_visible());
    assert!(!snapshot_has_buffer_named(&h, "AI Chat"));

    // The View menu row exists, unchecked.
    let screen = view_menu_screen(&mut h);
    assert!(
        screen.contains("☐ Chat AI"),
        "Chat AI should be listed in the View menu, unchecked. Screen:\n{screen}"
    );

    // Toggle ON. The panel opens a right-hand column with the virtual
    // "AI Chat" buffer hosting the widget panel (transcript + input).
    toggle_chat_panel(&mut h, true);
    assert!(snapshot_has_buffer_named(&h, "AI Chat"));

    // The panel is still open, and the View menu row is now checked.
    assert!(h.editor().is_chat_panel_visible());
    let screen = view_menu_screen(&mut h);
    assert!(
        screen.contains("☑ Chat AI"),
        "Chat AI should be checked while the chat panel is open. Screen:\n{screen}"
    );

    // Toggle OFF: the buffer and its split are removed again.
    toggle_chat_panel(&mut h, false);
    assert!(!snapshot_has_buffer_named(&h, "AI Chat"));

    // And the menu row is unchecked once more.
    let screen = view_menu_screen(&mut h);
    assert!(
        screen.contains("☐ Chat AI"),
        "Chat AI should be unchecked after the panel is closed. Screen:\n{screen}"
    );
}

/// Firing the editor's `ready` hook — what `main()` does right after the
/// full startup batch — opens the chat panel on its own when
/// `autoOpenChat` is left at its default (true). The input-loop prompt
/// appears too, and is cancelled here so nothing leaks into teardown.
#[test]
fn chat_ai_auto_opens_on_ready() {
    let (mut h, _tmp) = harness_with_ai_chat_autoopen();
    wait_for_toggle_command(&mut h);

    // Not open before the ready hook fires.
    assert!(!h.editor().is_chat_panel_visible());
    assert!(!snapshot_has_buffer_named(&h, "AI Chat"));

    h.editor_mut().fire_ready_hook();

    // The auto-open path (`ai_chat_auto_open` on `ready`) creates the
    // virtual "AI Chat" buffer in a right-hand split hosting the widget
    // panel.
    h.wait_until(|h| h.editor().is_chat_panel_visible())
        .unwrap();
    assert!(snapshot_has_buffer_named(&h, "AI Chat"));

    // The panel stays open after the prompt-free open.
    assert!(h.editor().is_chat_panel_visible());
}

/// Clipboard actions in the `ai_chat` mode must target the focused Text
/// widget, not the read-only virtual buffer that hosts the panel.
#[test]
fn chat_ai_input_pastes_clipboard_text() {
    let (mut h, _tmp) = harness_with_ai_chat();
    wait_for_toggle_command(&mut h);
    toggle_chat_panel(&mut h, true);
    h.wait_until_stable(|h| h.editor().is_chat_panel_visible())
        .unwrap();

    const PASTED: &str = "chat-clipboard-probe";
    h.editor_mut().set_clipboard_for_test(PASTED.to_string());
    h.send_key(KeyCode::Char('v'), KeyModifiers::CONTROL)
        .unwrap();
    h.wait_until(|h| h.screen_to_string().contains(PASTED))
        .unwrap();
}

/// Right-clicking the focused chat input raises the host's native Text menu;
/// activating Paste routes back to that exact widget, not the virtual buffer.
#[test]
fn chat_ai_input_context_menu_pastes_clipboard_text() {
    let (mut h, _tmp) = harness_with_ai_chat();
    wait_for_toggle_command(&mut h);
    toggle_chat_panel(&mut h, true);
    h.wait_until_stable(|h| h.editor().is_chat_panel_visible())
        .unwrap();

    const SEED: &str = "chat-context-seed";
    h.editor_mut().set_clipboard_for_test(SEED.to_string());
    h.send_key(KeyCode::Char('v'), KeyModifiers::CONTROL)
        .unwrap();
    h.wait_until(|h| h.screen_to_string().contains(SEED))
        .unwrap();

    let screen = h.screen_to_string();
    let (col, row) = screen
        .lines()
        .enumerate()
        .find_map(|(row, line)| {
            let byte = line.find(SEED)?;
            let col = line[..byte].chars().count() as u16 + 2;
            Some((col, row as u16))
        })
        .expect("chat input coordinates");
    h.mouse_right_click(col, row).unwrap();
    h.assert_screen_contains("Cut");
    h.assert_screen_contains("Copy");
    h.assert_screen_contains("Paste");
    h.assert_screen_contains("Select All");

    const MENU_PASTE: &str = "-from-context-menu";
    h.editor_mut()
        .set_clipboard_for_test(MENU_PASTE.to_string());
    // Cut is initially highlighted; move to Paste and activate it.
    h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
    h.send_key(KeyCode::Down, KeyModifiers::NONE).unwrap();
    h.send_key(KeyCode::Enter, KeyModifiers::NONE).unwrap();
    h.wait_until(|h| h.screen_to_string().contains(MENU_PASTE))
        .unwrap();
}
