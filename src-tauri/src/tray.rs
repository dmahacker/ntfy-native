use crate::state::{IconState, Snapshot, ViewMode};
use std::sync::Mutex;
use tauri::{
    AppHandle, Manager,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

const ID: &str = "ntfy-native";

#[cfg(target_os = "linux")]
fn host_registered(reply: &gio::glib::Variant) -> bool {
    if reply.type_().as_str() != "(v)" {
        return false;
    }
    reply
        .get::<(gio::glib::Variant,)>()
        .and_then(|(value,)| value.get::<bool>())
        .unwrap_or(false)
}

// libappindicator's loader panics if its optional shared library is absent.
// Probe first, and require a real SNI host rather than hiding behind an invisible icon.
#[cfg(target_os = "linux")]
pub fn host_available() -> bool {
    use gio::glib::variant::ToVariant;
    static LIBRARY: std::sync::OnceLock<Option<libloading::Library>> = std::sync::OnceLock::new();
    let library = LIBRARY.get_or_init(|| {
        ["libayatana-appindicator3.so.1", "libappindicator3.so.1"]
            .iter()
            .find_map(|name| {
                // Fixed system library names, retained for the rest of the process.
                unsafe { libloading::Library::new(name).ok() }
            })
    });
    if library.is_none() {
        return false;
    }
    let Ok(bus) = gio::bus_get_sync(gio::BusType::Session, None::<&gio::Cancellable>) else {
        return false;
    };
    let Ok(reply) = bus.call_sync(
        Some("org.kde.StatusNotifierWatcher"),
        "/StatusNotifierWatcher",
        "org.freedesktop.DBus.Properties",
        "Get",
        Some(
            &(
                "org.kde.StatusNotifierWatcher",
                "IsStatusNotifierHostRegistered",
            )
                .to_variant(),
        ),
        None,
        gio::DBusCallFlags::NO_AUTO_START,
        1000,
        None::<&gio::Cancellable>,
    ) else {
        return false;
    };
    host_registered(&reply)
}
#[cfg(not(target_os = "linux"))]
pub fn host_available() -> bool {
    true
}
struct TrayState {
    status: MenuItem<tauri::Wry>,
    messages: MenuItem<tauri::Wry>,
    connect: MenuItem<tauri::Wry>,
    disconnect: MenuItem<tauri::Wry>,
    icons: [Image<'static>; 4],
    last_icon: Mutex<Option<IconState>>,
}

// Do not copy the full message history into the native UI event queue.
pub struct Presentation {
    status: String,
    unread_count: usize,
    icon: IconState,
}
impl From<&Snapshot> for Presentation {
    fn from(snapshot: &Snapshot) -> Self {
        Self {
            status: snapshot.status.clone(),
            unread_count: snapshot.unread_count,
            icon: snapshot.icon(),
        }
    }
}

fn icon_index(icon: IconState) -> usize {
    usize::from(icon.connected) * 2 + usize::from(icon.unread)
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let icons = [
        Image::from_bytes(include_bytes!("../icons/tray-offline.png"))?,
        Image::from_bytes(include_bytes!("../icons/tray-offline-unread.png"))?,
        Image::from_bytes(include_bytes!("../icons/tray-connected.png"))?,
        Image::from_bytes(include_bytes!("../icons/tray-unread.png"))?,
    ];
    let status = MenuItem::with_id(app, "status", "正在初始化…", false, None::<&str>)?;
    let messages = MenuItem::with_id(app, "messages", "查看消息", true, None::<&str>)?;
    let mark_read = MenuItem::with_id(app, "mark_read", "全部标为已读", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "连接设置", true, None::<&str>)?;
    let connect = MenuItem::with_id(app, "connect", "连接", true, None::<&str>)?;
    let disconnect = MenuItem::with_id(app, "disconnect", "断开", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &messages,
            &mark_read,
            &settings,
            &connect,
            &disconnect,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    TrayIconBuilder::with_id(ID)
        .icon(icons[0].clone())
        .tooltip("ntfy native")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            if event.id.as_ref() == "quit" {
                app.exit(0);
                return;
            }
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let result = match event.id.as_ref() {
                    "messages" => crate::open_view(&app, ViewMode::Messages).await,
                    "mark_read" => {
                        crate::mark_all_read(&app).await;
                        Ok(())
                    }
                    "settings" => crate::open_view(&app, ViewMode::Settings).await,
                    "connect" => crate::reconnect_saved(&app).await,
                    "disconnect" => crate::disconnect(app.clone(), app.state()).await,
                    _ => Ok(()),
                };
                if let Err(error) = result {
                    crate::show_operation_error(&app, &error).await;
                }
            });
        })
        .build(app)?;
    app.manage(TrayState {
        status,
        messages,
        connect,
        disconnect,
        icons,
        last_icon: Mutex::new(None),
    });
    Ok(())
}

// Called on the UI thread; the snapshot was copied before queuing this update.
pub fn refresh(app: &AppHandle, snapshot: &Presentation) -> tauri::Result<()> {
    let Some(state) = app.try_state::<TrayState>() else {
        return Err(std::io::Error::other("Tray state unavailable").into());
    };
    let Some(tray) = app.tray_by_id(ID) else {
        return Err(std::io::Error::other("Tray unavailable").into());
    };
    let icon = snapshot.icon;
    let mut previous = state.last_icon.lock().unwrap_or_else(|e| e.into_inner());
    if *previous != Some(icon) {
        tray.set_icon(Some(state.icons[icon_index(icon)].clone()))?;
        *previous = Some(icon);
    }
    let status = match snapshot.status.as_str() {
        "connected" => "已连接",
        "connecting" => "连接中",
        "reconnecting" => "重连中",
        "error" => "连接失败",
        _ => "未连接",
    };
    state
        .status
        .set_text(format!("{status} · {} 条未读", snapshot.unread_count))?;
    state.messages.set_text(if snapshot.unread_count == 0 {
        "查看消息".into()
    } else {
        format!("查看消息（{} 条未读）", snapshot.unread_count)
    })?;
    let running = matches!(
        snapshot.status.as_str(),
        "connected" | "connecting" | "reconnecting"
    );
    state.connect.set_enabled(!running)?;
    state.disconnect.set_enabled(running)?;
    // Linux does not support tray tooltips. The menu and icon remain the primary UI.
    let _ = tray.set_tooltip(Some(format!(
        "ntfy native · {status} · {} 条未读",
        snapshot.unread_count
    )));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(target_os = "linux")]
    fn watcher_requires_a_registered_host_not_just_a_dbus_name() {
        use gio::glib::variant::ToVariant;
        assert!(host_registered(&(true.to_variant(),).to_variant()));
        assert!(!host_registered(&(false.to_variant(),).to_variant()));
        assert!(!host_registered(
            &("not a boolean".to_variant(),).to_variant()
        ));
        assert!(!host_registered(&(true,).to_variant()));
    }
    #[test]
    fn embedded_icons_are_valid_distinct_images_for_all_states() {
        let bytes = [
            include_bytes!("../icons/tray-offline.png").as_slice(),
            include_bytes!("../icons/tray-offline-unread.png").as_slice(),
            include_bytes!("../icons/tray-connected.png").as_slice(),
            include_bytes!("../icons/tray-unread.png").as_slice(),
        ];
        for (index, data) in bytes.iter().enumerate() {
            let image = Image::from_bytes(data).unwrap();
            assert_eq!((image.width(), image.height()), (64, 64));
            for other in bytes.iter().skip(index + 1) {
                assert_ne!(data, other);
            }
            assert_eq!(
                icon_index(IconState {
                    connected: index >= 2,
                    unread: index % 2 == 1
                }),
                index
            );
        }
    }
}
