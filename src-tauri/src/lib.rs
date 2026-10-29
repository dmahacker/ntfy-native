mod config;
mod subscription;

use config::Config;
use serde::Serialize;
use std::{path::PathBuf, sync::Arc, time::Duration};
use subscription::{Decoder, Message, Recent};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Mutex;

#[derive(Clone, Default, Serialize)]
struct Snapshot {
    revision: u64,
    status: String,
    detail: String,
    notification_error: Option<String>,
    messages: Vec<Message>,
}

#[derive(Default)]
struct Backend {
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    view: Arc<Mutex<Snapshot>>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("connection.json"))
        .map_err(|_| "无法定位应用配置目录".into())
}

async fn update(app: &AppHandle, view: &Mutex<Snapshot>, change: impl FnOnce(&mut Snapshot)) {
    let mut snapshot = view.lock().await;
    change(&mut snapshot);
    snapshot.revision += 1;
    let _ = app.emit("subscription-state", &*snapshot);
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

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Option<Config>, String> {
    config::load(&config_path(&app)?)
}

#[tauri::command]
async fn get_snapshot(backend: State<'_, Backend>) -> Result<Snapshot, String> {
    Ok(backend.view.lock().await.clone())
}

#[tauri::command]
async fn connect(
    app: AppHandle,
    backend: State<'_, Backend>,
    config: Config,
) -> Result<(), String> {
    config.subscription_url()?;
    let client = subscription::client()?;
    let mut task = backend.task.lock().await;
    // Save before stopping the existing connection: a disk error must not lose working settings.
    config.save(&config_path(&app)?)?;
    stop(&mut task).await;
    update(&app, &backend.view, |v| {
        v.status = "connecting".into();
        v.detail = "正在连接…".into();
        v.messages.clear();
        v.notification_error = None;
    })
    .await;
    let view = backend.view.clone();
    *task = Some(tauri::async_runtime::spawn(run_subscription(
        app, view, config, client,
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
                        let failed = app
                            .notification()
                            .builder()
                            .title(title)
                            .body(&message.message)
                            .show()
                            .is_err();
                        update(&app, &view, |v| {
                            if failed {
                                v.notification_error =
                                    Some("系统通知发送失败，请检查桌面通知服务及应用权限".into());
                            }
                            v.messages.insert(0, message);
                            v.messages.truncate(100);
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
        .manage(Backend::default())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            get_snapshot,
            connect,
            disconnect,
            clear_settings
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
