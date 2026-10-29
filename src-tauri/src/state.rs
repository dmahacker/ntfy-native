use crate::subscription::Message;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ViewMode {
    #[default]
    Settings,
    Messages,
}

#[derive(Clone, Default, Serialize)]
pub struct Snapshot {
    pub revision: u64,
    pub status: String,
    pub detail: String,
    pub notification_error: Option<String>,
    pub messages: Vec<Message>,
    pub view_mode: ViewMode,
    pub unread_count: usize,
    pub tray_error: Option<String>,
    pub tray_available: bool,
    #[serde(skip)]
    pub window_visible: bool,
    #[serde(skip)]
    pub window_focused: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IconState {
    pub connected: bool,
    pub unread: bool,
}

impl Snapshot {
    pub fn receive(&mut self, message: Message) {
        if !(self.view_mode == ViewMode::Messages && self.window_visible && self.window_focused) {
            self.unread_count = self.unread_count.saturating_add(1);
        }
        self.messages.insert(0, message);
        self.messages.truncate(100);
    }
    pub fn show_view(&mut self, mode: ViewMode) {
        self.view_mode = mode;
        if mode == ViewMode::Messages {
            self.unread_count = 0;
        }
    }
    pub fn window_changed(&mut self, visible: bool, focused: bool) {
        self.window_visible = visible;
        self.window_focused = focused;
        if visible && focused && self.view_mode == ViewMode::Messages {
            self.unread_count = 0;
        }
    }
    pub fn icon(&self) -> IconState {
        IconState {
            connected: self.status == "connected",
            unread: self.unread_count > 0,
        }
    }
    pub fn close_to_tray(&mut self) -> bool {
        if self.tray_available {
            self.window_changed(false, false);
            true
        } else {
            false
        }
    }
}
pub fn startup_view(configured: bool, tray_available: bool) -> Option<ViewMode> {
    if !configured {
        Some(ViewMode::Settings)
    } else if !tray_available {
        Some(ViewMode::Messages)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn message(n: usize) -> Message {
        Message {
            id: n.to_string(),
            time: 1,
            topic: "t".into(),
            title: String::new(),
            message: "hello".into(),
        }
    }
    #[test]
    fn background_messages_are_unread_but_opening_the_feed_clears_them() {
        let mut state = Snapshot::default();
        state.receive(message(1));
        assert_eq!(state.unread_count, 1);
        state.show_view(ViewMode::Settings);
        assert_eq!(state.unread_count, 1);
        state.show_view(ViewMode::Messages);
        assert_eq!(state.unread_count, 0);
        assert_eq!(state.messages.len(), 1);
    }
    #[test]
    fn only_the_visible_focused_feed_reads_new_messages() {
        let mut state = Snapshot::default();
        state.window_changed(true, true);
        state.receive(message(1));
        assert_eq!(state.unread_count, 1); // Settings never marks messages read.
        state.show_view(ViewMode::Messages);
        state.receive(message(2));
        assert_eq!(state.unread_count, 0);
        state.window_changed(true, false);
        state.receive(message(3));
        assert_eq!(state.unread_count, 1);
        state.window_changed(false, true);
        state.receive(message(4));
        assert_eq!(state.unread_count, 2);
        state.window_changed(true, true);
        assert_eq!(state.unread_count, 0);
    }
    #[test]
    fn unread_count_is_independent_of_bounded_message_list_and_connection_status() {
        let mut state = Snapshot::default();
        for i in 0..150 {
            state.receive(message(i));
        }
        state.status = "reconnecting".into();
        assert_eq!(state.messages.len(), 100);
        assert_eq!(state.unread_count, 150);
        assert_eq!(state.messages[0].id, "149");
    }
    #[test]
    fn unread_and_connection_have_four_distinct_icon_states() {
        let mut state = Snapshot::default();
        assert_eq!(
            state.icon(),
            IconState {
                connected: false,
                unread: false
            }
        );
        state.status = "connected".into();
        assert_eq!(
            state.icon(),
            IconState {
                connected: true,
                unread: false
            }
        );
        state.receive(message(1));
        assert_eq!(
            state.icon(),
            IconState {
                connected: true,
                unread: true
            }
        );
        state.status = "error".into();
        assert_eq!(
            state.icon(),
            IconState {
                connected: false,
                unread: true
            }
        );
    }
    #[test]
    fn startup_only_hides_when_configured_and_tray_is_available() {
        assert_eq!(startup_view(true, true), None);
        assert_eq!(startup_view(false, true), Some(ViewMode::Settings));
        assert_eq!(startup_view(false, false), Some(ViewMode::Settings));
        assert_eq!(startup_view(true, false), Some(ViewMode::Messages));
    }
    #[test]
    fn closing_hides_only_with_a_working_tray_and_stops_reading() {
        let mut state = Snapshot {
            tray_available: true,
            ..Default::default()
        };
        state.show_view(ViewMode::Messages);
        state.window_changed(true, true);
        assert!(state.close_to_tray());
        state.receive(message(1));
        assert_eq!(state.unread_count, 1);
        state.tray_available = false;
        assert!(!state.close_to_tray());
    }
}
