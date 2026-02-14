use redis::aio::ConnectionManager;
use redis::{AsyncCommands, Client};

use crate::config::Config;

#[derive(Clone)]
pub struct Cache {
    conn: ConnectionManager,
    prefix: String,
}

impl Cache {
    pub async fn new(config: &Config) -> Self {
        let url = config.redis_url();
        let client = Client::open(url).expect("Invalid Redis URL");
        let conn = ConnectionManager::new(client)
            .await
            .expect("Failed to connect to Redis");
        Self {
            conn,
            prefix: config.redis.key_prefix.clone(),
        }
    }

    fn key(&self, k: &str) -> String {
        format!("{}{}", self.prefix, k)
    }

    pub async fn get(&self, key: &str) -> Option<String> {
        let mut conn = self.conn.clone();
        redis::cmd("GET")
            .arg(self.key(key))
            .query_async::<Option<String>>(&mut conn)
            .await
            .ok()
            .flatten()
    }

    pub async fn get_json<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        self.get(key)
            .await
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    pub async fn set(&self, key: &str, value: &str, ttl_secs: u64) {
        let mut conn = self.conn.clone();
        let k = self.key(key);
        let _: Result<(), _> = if ttl_secs > 0 {
            conn.set_ex(&k, value, ttl_secs).await
        } else {
            conn.set(&k, value).await
        };
    }

    pub async fn set_json<T: serde::Serialize>(&self, key: &str, value: &T, ttl_secs: u64) {
        if let Ok(json) = serde_json::to_string(value) {
            self.set(key, &json, ttl_secs).await;
        }
    }

    pub async fn del(&self, key: &str) {
        let mut conn = self.conn.clone();
        let _: Result<(), _> = conn.del(self.key(key)).await;
    }

    pub async fn zadd(&self, key: &str, member: &str, score: f64) {
        let mut conn = self.conn.clone();
        let k = self.key(key);
        let _: Result<(), _> = conn.zadd(&k, member, score).await;
    }

    pub async fn zrevrange_withscores(
        &self,
        key: &str,
        start: isize,
        stop: isize,
    ) -> Vec<(String, f64)> {
        let mut conn = self.conn.clone();
        let k = self.key(key);
        conn.zrevrange_withscores(&k, start, stop)
            .await
            .unwrap_or_default()
    }

    pub async fn zrevrank(&self, key: &str, member: &str) -> Option<usize> {
        let mut conn = self.conn.clone();
        let k = self.key(key);
        conn.zrevrank(&k, member).await.ok()
    }

    pub async fn zscore(&self, key: &str, member: &str) -> Option<f64> {
        let mut conn = self.conn.clone();
        let k = self.key(key);
        conn.zscore(&k, member).await.ok()
    }

    pub async fn zcard(&self, key: &str) -> u64 {
        let mut conn = self.conn.clone();
        let k = self.key(key);
        conn.zcard(&k).await.unwrap_or(0)
    }

    pub async fn expire(&self, key: &str, secs: i64) {
        let mut conn = self.conn.clone();
        let k = self.key(key);
        let _: Result<(), _> = conn.expire(&k, secs).await;
    }

    pub async fn incr(&self, key: &str) -> i64 {
        let mut conn = self.conn.clone();
        let k = self.key(key);
        conn.incr(&k, 1i64).await.unwrap_or(0)
    }

    pub async fn health_check(&self) -> bool {
        let mut conn = self.conn.clone();
        redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .is_ok()
    }
}
