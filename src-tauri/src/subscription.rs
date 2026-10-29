use crate::config::Config;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::time::Duration;

const MAX_FRAME: usize = 64 * 1024;

#[derive(Clone, Deserialize, Serialize)]
pub struct Message {
    pub id: String,
    pub time: u64,
    pub topic: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub message: String,
}

#[derive(Default)]
pub struct Decoder {
    buffer: Vec<u8>,
}
impl Decoder {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Message>, String> {
        let mut messages = Vec::new();
        for part in chunk.split_inclusive(|c| *c == b'\n') {
            if self.buffer.len() + part.len() > MAX_FRAME {
                return Err("消息帧过大".into());
            }
            self.buffer.extend_from_slice(part);
            if part.ends_with(b"\n") {
                if !self.buffer.iter().all(u8::is_ascii_whitespace) {
                    let value: serde_json::Value = serde_json::from_slice(&self.buffer)
                        .map_err(|_| "服务器返回了无效的消息格式")?;
                    match value.get("event").and_then(|v| v.as_str()) {
                        Some("message") => {
                            let message: Message =
                                serde_json::from_value(value).map_err(|_| "消息缺少必要字段")?;
                            // Keep timestamps within JavaScript Date's representable range.
                            if message.time > 8_640_000_000_000 {
                                return Err("消息时间无效".into());
                            }
                            messages.push(message);
                        }
                        Some("open" | "keepalive") => {}
                        _ => return Err("服务器返回了不支持的事件".into()),
                    }
                }
                self.buffer.clear();
            }
        }
        Ok(messages)
    }
}

#[derive(Default)]
pub struct Recent {
    ids: VecDeque<String>,
}
impl Recent {
    pub fn accept(&mut self, id: &str) -> bool {
        if id.is_empty() || self.ids.iter().any(|seen| seen == id) {
            return false;
        }
        self.ids.push_back(id.into());
        if self.ids.len() > 1000 {
            self.ids.pop_front();
        }
        true
    }
    pub fn cursor(&self) -> Option<&str> {
        self.ids.back().map(String::as_str)
    }
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| "无法初始化网络客户端".into())
}
pub async fn open(
    client: &reqwest::Client,
    config: &Config,
    since: Option<&str>,
) -> Result<reqwest::Response, (String, bool)> {
    let mut url = config.subscription_url().map_err(|e| (e, false))?;
    if let Some(cursor) = since {
        url.query_pairs_mut().append_pair("since", cursor);
    }
    let response = client
        .get(url)
        .basic_auth(&config.username, Some(&config.password))
        .header(reqwest::header::ACCEPT, "application/x-ndjson")
        .send()
        .await
        .map_err(|_| ("无法连接服务器，请检查网络、地址和证书".into(), true))?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let message = match status.as_u16() {
        401 => "认证失败，请检查用户名和密码".into(),
        403 => "没有权限订阅该主题".into(),
        300..=399 => "服务器要求重定向，请直接填写最终服务器地址".into(),
        _ => format!("订阅请求失败（HTTP {}）", status.as_u16()),
    };
    Err((
        message,
        status.is_server_error() || matches!(status.as_u16(), 408 | 429),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    #[test]
    fn decodes_split_utf8_and_ignores_control_events() {
        let mut decoder = Decoder::default();
        let bytes = "{\"event\":\"open\"}\n{\"event\":\"message\",\"id\":\"a\",\"time\":1,\"topic\":\"t\",\"message\":\"你好\"}\n{\"event\":\"keepalive\"}\n".as_bytes();
        let mut messages = Vec::new();
        for byte in bytes {
            messages.extend(decoder.push(&[*byte]).unwrap());
        }
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].message, "你好");
    }
    #[test]
    fn rejects_bad_or_unbounded_frames() {
        assert!(Decoder::default().push(b"not json\n").is_err());
        assert!(Decoder::default().push(&vec![b'x'; MAX_FRAME + 1]).is_err());
        assert!(
            Decoder::default()
                .push(b"{\"event\":\"message\"}\n")
                .is_err()
        );
    }
    #[test]
    fn rejects_timestamps_that_would_crash_the_message_ui() {
        let frame =
            b"{\"event\":\"message\",\"id\":\"a\",\"time\":18446744073709551615,\"topic\":\"t\"}\n";
        assert!(Decoder::default().push(frame).is_err());
    }
    #[test]
    fn deduplicates_ids_without_rewinding_cursor_and_bounds_memory() {
        let mut recent = Recent::default();
        assert!(recent.accept("one"));
        assert!(recent.accept("two"));
        assert!(!recent.accept("one"));
        assert_eq!(recent.cursor(), Some("two"));
        assert!(!recent.accept(""));
        for i in 0..2000 {
            recent.accept(&i.to_string());
        }
        assert!(recent.ids.len() <= 1000);
    }
    async fn server(
        status: &str,
        since: Option<&str>,
    ) -> Result<reqwest::Response, (String, bool)> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let status = status.to_string();
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let text = String::from_utf8(request).unwrap();
            assert!(text.starts_with("GET /prefix/topic/json"));
            assert!(
                text.to_lowercase()
                    .contains("authorization: basic ywxpy2u6c2vjcmv0")
            );
            let body = "{\"event\":\"open\"}\n";
            write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/x-ndjson\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            text
        });
        let config = Config {
            server: format!("http://{addr}/prefix"),
            topic: "topic".into(),
            username: "alice".into(),
            password: "secret".into(),
        };
        let result = open(&client().unwrap(), &config, since).await;
        let request = thread.join().unwrap();
        match since {
            Some(cursor) => assert!(request.contains(&format!("?since={cursor} "))),
            None => assert!(request.starts_with("GET /prefix/topic/json HTTP/1.1\r\n")),
        }
        result
    }
    #[tokio::test]
    async fn sends_basic_auth_and_cursor_to_real_http_server() {
        assert!(server("200 OK", Some("last-id")).await.is_ok());
        assert!(server("200 OK", None).await.is_ok());
    }
    #[tokio::test]
    async fn auth_failure_is_terminal_redirect_is_not_followed_and_server_error_retries() {
        assert!(!server("401 Unauthorized", None).await.unwrap_err().1);
        assert!(!server("403 Forbidden", None).await.unwrap_err().1);
        assert!(!server("302 Found", None).await.unwrap_err().1);
        assert!(server("503 Unavailable", None).await.unwrap_err().1);
    }
}
