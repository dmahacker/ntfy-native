mod config;
mod notification;
mod preferences;
mod state;
mod subscription;
mod tray;

use config::Config;
use state::{Snapshot, ViewMode};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use subscription::{Decoder, Recent};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

#[derive(Default)]
struct Backend {
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    view: Arc<Mutex<Snapshot>>,
    tray_available: AtomicBool,
    preferences: Mutex<preferences::Preferences>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("connection.json"))
        .map_err(|_| "无法定位应用配置目录".into())
}

fn preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("preferences.json"))
        .map_err(|_| "无法定位应用配置目录".into())
}
#[tauri::command]
async fn get_sound_enabled(app: AppHandle, backend: State<'_, Backend>) -> Result<bool, String> {
    let mut settings = backend.preferences.lock().await;
    *settings = preferences::load(&preferences_path(&app)?)?;
    Ok(settings.sound_enabled)
}
#[tauri::command]
async fn set_sound_enabled(
    app: AppHandle,
    backend: State<'_, Backend>,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = backend.preferences.lock().await;
    let next = preferences::Preferences {
        sound_enabled: enabled,
    };
    next.save(&preferences_path(&app)?)?;
    *settings = next;
    Ok(())
}
async fn mark_all_read(app: &AppHandle) {
    update(app, &app.state::<Backend>().view, Snapshot::mark_all_read).await;
}

async fn update(app: &AppHandle, view: &Mutex<Snapshot>, change: impl FnOnce(&mut Snapshot)) {
    let mut snapshot = view.lock().await;
    change(&mut snapshot);
    snapshot.revision += 1;
    let _ = app.emit("subscription-state", &*snapshot);
    if app.state::<Backend>().tray_available.load(Ordering::SeqCst) {
        let next = tray::Presentation::from(&*snapshot);
        let handle = app.clone();
        if app
            .run_on_main_thread(move || {
                if tray::refresh(&handle, &next).is_err() {
                    tray_unavailable(&handle);
                }
            })
            .is_err()
        {
            tray_unavailable(app);
        }
    }
}

async fn status(app: &AppHandle, view: &Mutex<Snapshot>, state: &str, detail: &str) {
    update(app, view, |v| {
        v.status = state.into();
        v.detail = detail.into();
    })
    .await;
}

async fn stop(task: &mut Option<tauri::async_runtime::JoinHandle<()>>) {
    if let Some(handle) = task.take() {
        handle.abort();
        let _ = handle.await;
    }
}

// This path never calls update(): a failed tray update must not recursively retry itself.
fn tray_unavailable(app: &AppHandle) {
    app.state::<Backend>()
        .tray_available
        .store(false, Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let backend = app.state::<Backend>();
        let mut snapshot = backend.view.lock().await;
        snapshot.tray_available = false;
        snapshot.tray_error = Some("托盘不可用，已保留窗口；关闭窗口将退出程序。".into());
        snapshot.revision += 1;
        let _ = app.emit("subscription-state", &*snapshot);
        drop(snapshot);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_skip_taskbar(false);
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}

async fn hide_window(app: &AppHandle) -> Result<(), String> {
    let backend = app.state::<Backend>();
    if !backend.tray_available.load(Ordering::SeqCst) {
        return Ok(());
    }
    update(app, &backend.view, |v| {
        v.close_to_tray();
    })
    .await;
    let window = app.get_webview_window("main").ok_or("无法找到应用窗口")?;
    if window.hide().is_err() {
        update(app, &backend.view, |v| v.window_changed(true, false)).await;
        return Err("无法隐藏窗口，程序仍在运行".into());
    }
    // A tray update may have failed while hide() was being dispatched.
    if !backend.tray_available.load(Ordering::SeqCst) {
        window.show().map_err(|_| "托盘不可用且无法恢复窗口")?;
    }
    Ok(())
}

fn window_activity(app: &AppHandle) -> (bool, bool) {
    let Some(window) = app.get_webview_window("main") else {
        return (false, false);
    };
    (
        window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false),
        window.is_focused().unwrap_or(false),
    )
}
async fn open_view(app: &AppHandle, mode: ViewMode) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("无法找到应用窗口")?;
    window.unminimize().map_err(|_| "无法恢复应用窗口")?;
    window.show().map_err(|_| "无法显示应用窗口")?;
    let _ = window.set_focus();
    let focused = window.is_focused().unwrap_or(false);
    update(app, &app.state::<Backend>().view, |v| {
        v.show_view(mode);
        v.window_changed(true, focused);
    })
    .await;
    Ok(())
}

#[tauri::command]
async fn show_view(app: AppHandle, mode: ViewMode) -> Result<(), String> {
    open_view(&app, mode).await
}

async fn reconnect_saved(app: &AppHandle) -> Result<(), String> {
    match config::load(&config_path(app)?)? {
        Some(config) => start_subscription(app, config, false).await,
        None => open_view(app, ViewMode::Settings).await,
    }
}

async fn show_operation_error(app: &AppHandle, error: &str) {
    status(app, &app.state::<Backend>().view, "error", error).await;
    let _ = open_view(app, ViewMode::Settings).await;
}

async fn initialize(app: AppHandle, tray_available: bool) {
    let backend = app.state::<Backend>();
    let saved_preferences = preferences_path(&app).and_then(|path| preferences::load(&path));
    match saved_preferences {
        Ok(settings) => *backend.preferences.lock().await = settings,
        Err(error) => update(&app, &backend.view, |v| v.notification_error = Some(error)).await,
    }
    update(&app, &backend.view, |v| {
        v.tray_available = tray_available;
        if !tray_available {
            v.tray_error = Some("托盘不可用，已保留窗口；关闭窗口将退出程序。".into());
        }
    })
    .await;
    let saved = config_path(&app).and_then(|path| config::load(&path));
    let configured = matches!(saved, Ok(Some(_)));
    if let Some(mode) = state::startup_view(configured, tray_available) {
        if !tray_available && let Some(window) = app.get_webview_window("main") {
            let _ = window.set_skip_taskbar(false);
        }
        let _ = open_view(&app, mode).await;
    }
    match saved {
        Ok(Some(config)) => {
            if let Err(error) = start_subscription(&app, config, false).await {
                status(&app, &backend.view, "error", &error).await;
            }
        }
        Ok(None) => status(&app, &backend.view, "disconnected", "请先配置连接").await,
        Err(error) => status(&app, &backend.view, "error", &error).await,
    }
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Option<Config>, String> {
    config::load(&config_path(&app)?)
}

#[tauri::command]
async fn get_snapshot(backend: State<'_, Backend>) -> Result<Snapshot, String> {
    Ok(backend.view.lock().await.clone())
}

#[tauri::command]
async fn connect(app: AppHandle, config: Config) -> Result<(), String> {
    start_subscription(&app, config, true).await?;
    hide_window(&app).await
}

async fn start_subscription(app: &AppHandle, config: Config, save: bool) -> Result<(), String> {
    config.subscription_url()?;
    let client = subscription::client()?;
    let backend = app.state::<Backend>();
    let mut task = backend.task.lock().await;
    // A disk error must not terminate an existing working subscription.
    if save {
        config.save(&config_path(app)?)?;
    }
    stop(&mut task).await;
    update(app, &backend.view, |v| {
        v.status = "connecting".into();
        v.detail = "正在连接…".into();
        v.messages.clear();
        v.unread_count = 0;
        v.notification_error = None;
    })
    .await;
    let view = backend.view.clone();
    *task = Some(tauri::async_runtime::spawn(run_subscription(
        app.clone(),
        view,
        config,
        client,
    )));
    Ok(())
}

#[tauri::command]
async fn disconnect(app: AppHandle, backend: State<'_, Backend>) -> Result<(), String> {
    let mut task = backend.task.lock().await;
    stop(&mut task).await;
    status(&app, &backend.view, "disconnected", "已断开，配置仍保留").await;
    Ok(())
}

#[tauri::command]
async fn clear_settings(app: AppHandle, backend: State<'_, Backend>) -> Result<(), String> {
    let mut task = backend.task.lock().await;
    let path = config_path(&app)?;
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("无法清除配置文件，请检查目录权限".into()),
    }
    stop(&mut task).await;
    update(&app, &backend.view, |v| {
        v.status = "disconnected".into();
        v.detail = "已清除配置".into();
        v.messages.clear();
        v.notification_error = None;
        v.unread_count = 0;
        v.show_view(ViewMode::Settings);
    })
    .await;
    Ok(())
}

async fn run_subscription(
    app: AppHandle,
    view: Arc<Mutex<Snapshot>>,
    config: Config,
    client: reqwest::Client,
) {
    let mut recent = Recent::default();
    let mut delay = 1;
    loop {
        let failure = match subscription::open(&client, &config, recent.cursor()).await {
            Err(failure) => failure,
            Ok(mut response) => {
                status(&app, &view, "connected", "已连接，正在接收消息").await;
                let mut decoder = Decoder::default();
                let connected_at = tokio::time::Instant::now();
                loop {
                    let chunk = match response.chunk().await {
                        Ok(Some(chunk)) => chunk,
                        _ => break ("连接中断或超时".into(), true),
                    };
                    let messages = match decoder.push(&chunk) {
                        Ok(messages) => messages,
                        Err(error) => break (error, false),
                    };
                    // A server that sends only "open" then closes must still back off.
                    if connected_at.elapsed() >= Duration::from_secs(30) {
                        delay = 1;
                    }
                    for message in messages {
                        if !recent.accept(&message.id) {
                            continue;
                        }
                        let title = if message.title.is_empty() {
                            format!("ntfy · {}", message.topic)
                        } else {
                            message.title.clone()
                        };
                        let sound_enabled = app
                            .state::<Backend>()
                            .preferences
                            .lock()
                            .await
                            .sound_enabled;
                        let notification =
                            notification::build(&title, &message.message, sound_enabled);
                        #[cfg(target_os = "macos")]
                        let _ = notify_rust::set_application(if tauri::is_dev() {
                            "com.apple.Terminal"
                        } else {
                            &app.config().identifier
                        });
                        #[cfg(target_os = "windows")]
                        let notification = {
                            let mut notification = notification;
                            notification.app_id(&app.config().identifier);
                            notification
                        };
                        // The native D-Bus call can block; do not stall the async subscription runtime.
                        let failed = tauri::async_runtime::spawn_blocking(move || {
                            notification::show(notification).is_err()
                        })
                        .await
                        .unwrap_or(true);
                        let (visible, focused) = window_activity(&app);
                        update(&app, &view, |v| {
                            if failed {
                                v.notification_error =
                                    Some("系统通知发送失败，请检查桌面通知服务及应用权限".into());
                            }
                            v.window_changed(visible, focused);
                            v.receive(message);
                        })
                        .await;
                    }
                }
            }
        };
        if !failure.1 {
            status(&app, &view, "error", &failure.0).await;
            return;
        }
        status(
            &app,
            &view,
            "reconnecting",
            &format!("{}，{} 秒后重连", failure.0, delay),
        )
        .await;
        tokio::time::sleep(Duration::from_secs(delay)).await;
        delay = (delay * 2).min(30);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin({
            let builder = tauri_plugin_autostart::Builder::new();
            #[cfg(target_os = "macos")]
            let builder =
                builder.macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent);
            builder.build()
        })
        .manage(Backend::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let available = tray::host_available() && tray::setup(app.handle()).is_ok();
            app.state::<Backend>()
                .tray_available
                .store(available, Ordering::SeqCst);
            tauri::async_runtime::spawn(initialize(app.handle().clone(), available));
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle().clone();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. }
                    if app.state::<Backend>().tray_available.load(Ordering::SeqCst) =>
                {
                    api.prevent_close();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = hide_window(&app).await {
                            show_operation_error(&app, &error).await;
                        }
                    });
                }
                tauri::WindowEvent::Focused(_) => {
                    tauri::async_runtime::spawn(async move {
                        let (visible, focused) = window_activity(&app);
                        update(&app, &app.state::<Backend>().view, |v| {
                            v.window_changed(visible, focused)
                        })
                        .await;
                    });
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            get_snapshot,
            get_sound_enabled,
            set_sound_enabled,
            connect,
            disconnect,
            clear_settings,
            show_view
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn disconnect_waits_until_old_task_can_no_longer_deliver_messages() {
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (deliver_tx, deliver_rx) = tokio::sync::oneshot::channel::<()>();
        let delivered = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = delivered.clone();
        let mut task = Some(tauri::async_runtime::spawn(async move {
            let _ = started_tx.send(());
            let _ = deliver_rx.await;
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
        }));
        started_rx.await.unwrap();
        stop(&mut task).await;
        assert!(task.is_none());
        assert!(deliver_tx.send(()).is_err());
        assert!(!delivered.load(std::sync::atomic::Ordering::SeqCst));
        stop(&mut task).await;
    }
}
