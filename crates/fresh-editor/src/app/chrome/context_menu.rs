//! Context menu (right-click menus): the menu box and its full-frame
//! close guard.

use anyhow::Result as AnyhowResult;
use fresh_i18n::t;

use super::Editor;

/// Behavior owned by this component (moved from mouse_input.rs —
/// the handlers its arms dispatch to).
impl Editor {
    /// Activate the highlighted item of the open context menu: resolve the
    /// item + its payload from the concrete menu, dismiss the menu, then run
    /// the matching `execute_*` action. Shared by both the keyboard (Enter)
    /// and mouse (click) paths so activation lives in exactly one place — the
    /// pointer path now reaches it from the shell (`apply_ui_fact`), the
    /// keyboard path still from this component.
    pub(crate) fn activate_highlighted_context_menu(
        &mut self,
        kind: crate::app::types::ContextMenuKind,
    ) -> AnyhowResult<()> {
        use crate::app::types::ContextMenuKind;
        match kind {
            ContextMenuKind::Tab => {
                let selected = self
                    .active_window()
                    .tab_context_menu
                    .as_ref()
                    .map(|m| (m.highlighted_item(), m.buffer_id, m.split_id));
                self.active_window_mut().close_context_menus();
                if let Some((item, buffer_id, split_id)) = selected {
                    return self.execute_tab_context_menu_action(item, buffer_id, split_id);
                }
            }
            ContextMenuKind::NewTab => {
                let selected = self
                    .active_window()
                    .new_tab_menu
                    .as_ref()
                    .map(|m| (m.highlighted_item(), m.split_id));
                self.active_window_mut().close_context_menus();
                if let Some((item, split_id)) = selected {
                    return self.execute_new_tab_menu_action(item, split_id);
                }
            }
            ContextMenuKind::FileExplorer => {
                let selected = self
                    .active_window()
                    .file_explorer_context_menu
                    .as_ref()
                    .map(|m| m.highlighted_item());
                self.active_window_mut().close_context_menus();
                if let Some(item) = selected {
                    self.execute_file_explorer_context_menu_action(item);
                }
            }
            ContextMenuKind::CloseSplit => {
                let selected = self
                    .active_window()
                    .close_split_menu
                    .as_ref()
                    .map(|m| (m.highlighted_item(), m.split_id));
                self.active_window_mut().close_context_menus();
                if let Some((item, split_id)) = selected {
                    self.execute_close_split_menu_action(item, split_id);
                }
            }
            ContextMenuKind::Text => {
                let selected = self.active_window().text_context_menu.as_ref().map(|m| {
                    (
                        m.highlighted_item(),
                        m.panel_key.clone(),
                        m.widget_key.clone(),
                    )
                });
                self.active_window_mut().close_context_menus();
                let Some((item, panel_key, widget_key)) = selected else {
                    return Ok(());
                };
                if !self.panel_focused_text_is(&panel_key, &widget_key) {
                    return Ok(());
                }
                use crate::app::types::TextContextMenuItem;
                match item {
                    TextContextMenuItem::Cut => {
                        if self.handle_widget_cut(&panel_key) {
                            self.set_status_message(t!("clipboard.cut").to_string());
                        }
                    }
                    TextContextMenuItem::Copy => {
                        if self.handle_widget_copy(&panel_key) {
                            self.set_status_message(t!("clipboard.copied").to_string());
                        }
                    }
                    TextContextMenuItem::Paste => {
                        if let Some(text) = self.clipboard.paste() {
                            let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
                            self.handle_widget_insert_str(&panel_key, &normalized);
                            self.set_status_message(t!("clipboard.pasted").to_string());
                        }
                    }
                    TextContextMenuItem::SelectAll => {
                        self.handle_widget_select_all(&panel_key);
                    }
                }
            }
        }
        Ok(())
    }
}
