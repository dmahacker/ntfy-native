use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Deserialize, Serialize)]
pub struct Preferences {
    pub sound_enabled: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            sound_enabled: true,
        }
    }
}
pub fn load(path: &Path) -> Result<Preferences, String> {
    match fs::read(path) {
        Ok(data) => {
            serde_json::from_slice(&data).map_err(|_| "声音设置损坏，请检查配置文件".into())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(_) => Err("无法读取声音设置".into()),
    }
}
impl Preferences {
    pub fn save(&self, path: &Path) -> Result<(), String> {
        use std::io::Write;
        let result = (|| -> std::io::Result<()> {
            let parent = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
            fs::create_dir_all(parent)?;
            let mut file = tempfile::NamedTempFile::new_in(parent)?;
            file.write_all(&serde_json::to_vec(self)?)?;
            file.as_file().sync_all()?;
            file.persist(path).map_err(|error| error.error)?;
            Ok(())
        })();
        result.map_err(|_| "无法保存声音设置".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_on_and_persists_independently_of_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("preferences.json");
        assert!(load(&path).unwrap().sound_enabled);
        Preferences {
            sound_enabled: false,
        }
        .save(&path)
        .unwrap();
        assert!(!load(&path).unwrap().sound_enabled);
        assert!(!dir.path().join("connection.json").exists());
    }
    #[test]
    fn rejects_corrupted_preferences_and_failed_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("preferences.json");
        fs::write(&path, "broken").unwrap();
        assert!(load(&path).is_err());
        assert!(Preferences::default().save(dir.path()).is_err());
    }
}
