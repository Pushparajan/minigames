use sqlx::postgres::{PgPool, PgPoolOptions};

use crate::config::Config;

pub async fn create_pool(config: &Config) -> PgPool {
    let url = config.database_url();
    PgPoolOptions::new()
        .min_connections(config.db.pool_min)
        .max_connections(config.db.pool_max)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(&url)
        .await
        .expect("Failed to connect to PostgreSQL")
}
