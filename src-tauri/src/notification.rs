use notify_rust::Notification;

pub fn build(title: &str, body: &str, sound_enabled: bool) -> Notification {
    let mut notification = Notification::new();
    notification.summary(title).body(body);
    #[cfg(target_os = "linux")]
    {
        notification.hint(notify_rust::Hint::SuppressSound(!sound_enabled));
        if sound_enabled {
            notification.sound_name("message-new-instant");
        }
    }
    #[cfg(target_os = "macos")]
    if sound_enabled {
        notification.sound_name("Ping");
    }
    #[cfg(target_os = "windows")]
    if sound_enabled {
        notification.sound_name("Default");
    }
    notification
}

#[cfg(target_os = "linux")]
fn payload(notification: Notification) -> gio::glib::Variant {
    use gio::glib::variant::ToVariant;
    let mut hints = std::collections::HashMap::<String, gio::glib::Variant>::new();
    for hint in notification.hints {
        match hint {
            notify_rust::Hint::SuppressSound(value) => {
                hints.insert("suppress-sound".into(), value.to_variant());
            }
            notify_rust::Hint::SoundName(value) => {
                hints.insert("sound-name".into(), value.to_variant());
            }
            _ => {}
        }
    }
    (
        "ntfy-native",
        0u32,
        "",
        notification.summary,
        notification.body,
        Vec::<String>::new(),
        hints,
        -1i32,
    )
        .to_variant()
}
// Keep the sender connection alive: some notification servers close notifications on disconnect.
#[cfg(target_os = "linux")]
pub fn show(notification: Notification) -> Result<(), String> {
    use std::sync::OnceLock;
    static BUS: OnceLock<gio::DBusConnection> = OnceLock::new();
    let connection = match BUS.get() {
        Some(connection) => connection.clone(),
        None => {
            let connection = gio::bus_get_sync(gio::BusType::Session, None::<&gio::Cancellable>)
                .map_err(|e| e.to_string())?;
            let _ = BUS.set(connection.clone());
            connection
        }
    };
    connection
        .call_sync(
            Some("org.freedesktop.Notifications"),
            "/org/freedesktop/Notifications",
            "org.freedesktop.Notifications",
            "Notify",
            Some(&payload(notification)),
            None,
            gio::DBusCallFlags::NONE,
            2000,
            None::<&gio::Cancellable>,
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(not(target_os = "linux"))]
pub fn show(notification: Notification) -> Result<(), String> {
    notification.show().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    #[test]
    fn dbus_payload_has_correct_signature_and_sound_hints() {
        for enabled in [true, false] {
            let value = payload(build("title", "body", enabled));
            assert_eq!(value.type_().as_str(), "(susssasa{sv}i)");
            let hints = value
                .child_value(6)
                .get::<std::collections::HashMap<String, gio::glib::Variant>>()
                .unwrap();
            assert_eq!(hints["suppress-sound"].get::<bool>(), Some(!enabled));
            assert_eq!(hints.contains_key("sound-name"), enabled);
        }
    }
    #[test]
    fn sound_settings_do_not_change_notification_content() {
        for enabled in [true, false] {
            let notification = build("title", "body", enabled);
            assert_eq!(notification.summary, "title");
            assert_eq!(notification.body, "body");
            #[cfg(target_os = "linux")]
            {
                assert!(
                    notification
                        .hints
                        .contains(&notify_rust::Hint::SuppressSound(!enabled))
                );
            }
        }
    }
}
