use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub node_env: String,
    pub cors_origins: Vec<String>,
    pub db: DbConfig,
    pub redis: RedisConfig,
    pub jwt: JwtConfig,
    pub rate_limit: RateLimitConfig,
    pub leaderboard: LeaderboardConfig,
    pub tenant: TenantConfig,
    pub stripe: StripeConfig,
}

#[derive(Clone, Debug)]
pub struct DbConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
    pub pool_min: u32,
    pub pool_max: u32,
}

#[derive(Clone, Debug)]
pub struct RedisConfig {
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    pub db: u8,
    pub key_prefix: String,
}

#[derive(Clone, Debug)]
pub struct JwtConfig {
    pub secret: String,
    pub access_expiry_secs: i64,
    pub refresh_expiry_secs: i64,
}

#[derive(Clone, Debug)]
pub struct RateLimitConfig {
    pub window_secs: u64,
    pub max_requests: u32,
    pub score_submit_max: u32,
}

#[derive(Clone, Debug)]
pub struct LeaderboardConfig {
    pub shard_count: u32,
    pub page_size: u32,
    pub cache_seconds: u32,
}

#[derive(Clone, Debug)]
pub struct TenantConfig {
    pub default_tenant_id: String,
    pub api_key_header: String,
}

#[derive(Clone, Debug)]
pub struct StripeConfig {
    pub secret_key: String,
    pub publishable_key: String,
    pub webhook_secret: String,
    pub pricing_table_id: String,
    pub trial_days: u32,
    pub portal_return_url: String,
    pub price_starter: String,
    pub price_pro: String,
    pub price_enterprise: String,
}

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_or_parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            port: env_or_parse("PORT", 3000),
            node_env: env_or("NODE_ENV", "development"),
            cors_origins: env_or("CORS_ORIGINS", "http://localhost:3000,http://localhost:8080")
                .split(',')
                .map(|s| s.trim().to_string())
                .collect(),
            db: DbConfig {
                host: env_or("DB_HOST", "localhost"),
                port: env_or_parse("DB_PORT", 5432),
                database: env_or("DB_NAME", "stem_adventures"),
                user: env_or("DB_USER", "stem_admin"),
                password: env_or("DB_PASSWORD", ""),
                pool_min: env_or_parse("DB_POOL_MIN", 5),
                pool_max: env_or_parse("DB_POOL_MAX", 50),
            },
            redis: RedisConfig {
                host: env_or("REDIS_HOST", "localhost"),
                port: env_or_parse("REDIS_PORT", 6379),
                password: env::var("REDIS_PASSWORD").ok().filter(|s| !s.is_empty()),
                db: env_or_parse("REDIS_DB", 0),
                key_prefix: "stem:".to_string(),
            },
            jwt: JwtConfig {
                secret: env_or("JWT_SECRET", "change-me-to-a-secure-random-string"),
                access_expiry_secs: parse_duration_to_secs(&env_or("JWT_ACCESS_EXPIRY", "1h")),
                refresh_expiry_secs: parse_duration_to_secs(&env_or("JWT_REFRESH_EXPIRY", "30d")),
            },
            rate_limit: RateLimitConfig {
                window_secs: 60,
                max_requests: env_or_parse("RATE_LIMIT_MAX", 100),
                score_submit_max: env_or_parse("RATE_LIMIT_SCORE", 30),
            },
            leaderboard: LeaderboardConfig {
                shard_count: env_or_parse("LEADERBOARD_SHARDS", 8),
                page_size: env_or_parse("LEADERBOARD_PAGE_SIZE", 50),
                cache_seconds: env_or_parse("LEADERBOARD_CACHE_SEC", 30),
            },
            tenant: TenantConfig {
                default_tenant_id: env_or("DEFAULT_TENANT_ID", "stem_default"),
                api_key_header: "x-api-key".to_string(),
            },
            stripe: StripeConfig {
                secret_key: env_or("STRIPE_SECRET_KEY", ""),
                publishable_key: env_or("STRIPE_PUBLISHABLE_KEY", ""),
                webhook_secret: env_or("STRIPE_WEBHOOK_SECRET", ""),
                pricing_table_id: env_or("STRIPE_PRICING_TABLE_ID", ""),
                trial_days: env_or_parse("STRIPE_TRIAL_DAYS", 14),
                portal_return_url: env_or(
                    "STRIPE_PORTAL_RETURN_URL",
                    "http://localhost:8080/billing",
                ),
                price_starter: env_or("STRIPE_PRICE_STARTER", ""),
                price_pro: env_or("STRIPE_PRICE_PRO", ""),
                price_enterprise: env_or("STRIPE_PRICE_ENTERPRISE", ""),
            },
        }
    }

    pub fn database_url(&self) -> String {
        if let Ok(url) = env::var("DATABASE_URL") {
            return url;
        }
        if let Ok(url) = env::var("POSTGRES_URL") {
            return url;
        }
        format!(
            "postgres://{}:{}@{}:{}/{}",
            self.db.user, self.db.password, self.db.host, self.db.port, self.db.database
        )
    }

    pub fn redis_url(&self) -> String {
        if let Ok(url) = env::var("REDIS_URL") {
            return url;
        }
        if let Ok(url) = env::var("KV_URL") {
            return url;
        }
        match &self.redis.password {
            Some(pw) if !pw.is_empty() => format!(
                "redis://:{}@{}:{}/{}",
                pw, self.redis.host, self.redis.port, self.redis.db
            ),
            _ => format!(
                "redis://{}:{}/{}",
                self.redis.host, self.redis.port, self.redis.db
            ),
        }
    }
}

fn parse_duration_to_secs(s: &str) -> i64 {
    let s = s.trim();
    if s.is_empty() {
        return 3600;
    }
    let (num_str, unit) = s.split_at(s.len() - 1);
    let num: i64 = num_str.parse().unwrap_or(1);
    match unit {
        "s" => num,
        "m" => num * 60,
        "h" => num * 3600,
        "d" => num * 86400,
        _ => s.parse().unwrap_or(3600),
    }
}
