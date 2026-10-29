use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Config {
    pub server: String,
    pub topic: String,
    pub username: String,
    pub password: String,
}

impl Config {
    pub fn subscription_url(&self) -> Result<reqwest::Url, String> {
        let mut url = reqwest::Url::parse(self.server.trim()).map_err(|_| "服务器地址无效")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || self.server.len() > 2048
        {
            return Err("请使用不含账号、查询参数或片段的 HTTP(S) 服务器地址".into());
        }
        if self.topic.is_empty()
            || self.topic.len() > 64
            || !self
                .topic
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
        {
            return Err("主题须为 1–64 位字母、数字、下划线或连字符".into());
        }
        if self.username.trim().is_empty()
            || self.username.contains(':')
            || self.username.chars().any(char::is_control)
            || self.password.is_empty()
            || self.username.len() > 512
            || self.password.len() > 4096
        {
            return Err("请填写有效的用户名和密码（用户名不能包含冒号或控制字符）".into());
        }
        url.path_segments_mut()
            .map_err(|_| "服务器路径无效")?
            .pop_if_empty()
            .push(&self.topic)
            .push("json");
        Ok(url)
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        use std::io::Write;
        self.subscription_url()?;
        let parent = path.parent().ok_or("配置目录无效")?;
        let result = (|| -> std::io::Result<()> {
            let mut builder = fs::DirBuilder::new();
            builder.recursive(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
                builder.mode(0o700);
                builder.create(parent)?;
                fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
            }
            #[cfg(not(unix))]
            builder.create(parent)?;
            let mut file = tempfile::NamedTempFile::new_in(parent)?;
            file.write_all(&serde_json::to_vec_pretty(self)?)?;
            file.as_file().sync_all()?;
            file.persist(path).map_err(|e| e.error)?;
            Ok(())
        })();
        result.map_err(|_| "无法保存配置，请检查应用配置目录权限".into())
    }
}

pub fn load(path: &Path) -> Result<Option<Config>, String> {
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取已保存的配置".into()),
    };
    let config: Config =
        serde_json::from_slice(&data).map_err(|_| "已保存的配置损坏，请重新配置或清除配置")?;
    config.subscription_url()?;
    Ok(Some(config))
}

#[cfg(test)]
mod tests {
    use super::*;
    pub fn config() -> Config {
        Config {
            server: "https://example.com/ntfy/".into(),
            topic: "private-topic".into(),
            username: "alice".into(),
            password: " password : secret ".into(),
        }
    }
    #[test]
    fn builds_url_with_prefix() {
        assert_eq!(
            config().subscription_url().unwrap().as_str(),
            "https://example.com/ntfy/private-topic/json"
        );
    }
    #[test]
    fn rejects_unsafe_urls_and_topics() {
        for server in [
            "ftp://host",
            "https://a:b@host",
            "https://host?q=1",
            "https://host/#fragment",
            "not a url",
        ] {
            assert!(
                Config {
                    server: server.into(),
                    ..config()
                }
                .subscription_url()
                .is_err()
            );
        }
        for topic in ["", "a,b", "../x", "a/b", "my topic", ".", "é"] {
            assert!(
                Config {
                    topic: topic.into(),
                    ..config()
                }
                .subscription_url()
                .is_err()
            );
        }
        assert!(
            Config {
                username: "user:bad".into(),
                ..config()
            }
            .subscription_url()
            .is_err()
        );
    }
    #[test]
    fn persists_password_exactly_and_replaces_configuration() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("private/config.json");
        assert!(load(&path).unwrap().is_none());
        config().save(&path).unwrap();
        assert_eq!(load(&path).unwrap().unwrap().password, config().password);
        let mut updated = config();
        updated.topic = "updated".into();
        updated.save(&path).unwrap();
        assert_eq!(load(&path).unwrap().unwrap().topic, "updated");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
    }
    #[test]
    fn damaged_config_is_not_silently_discarded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, "broken").unwrap();
        assert!(load(&path).is_err());
    }
}
