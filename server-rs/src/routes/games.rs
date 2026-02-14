use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthPlayer;
use crate::middleware::tenant::TenantId;
use crate::models::multiplayer::*;
use crate::AppState;

// Public endpoints

pub async fn list_custom_games(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<CustomGame> = sqlx::query_as(
        "SELECT * FROM custom_games WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order",
    )
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "games": rows })))
}

pub async fn list_categories(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let categories: Vec<GameCategory> = sqlx::query_as(
        "SELECT * FROM game_categories WHERE tenant_id = $1 AND is_active = true ORDER BY sort_order",
    )
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let assignments: Vec<(String, String, i32)> = sqlx::query_as(
        "SELECT game_id, category_id, sort_order FROM game_category_assignments WHERE tenant_id = $1",
    )
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "categories": categories, "assignments": assignments })))
}

// Admin endpoints

pub async fn admin_list_games(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<(String, String, String, Option<bool>, i32, bool, Option<String>)> = sqlx::query_as(
        r#"SELECT cg.id, cg.title, cg.tenant_id, cg.classic, cg.sort_order, cg.is_active,
            p.display_name as created_by_name
        FROM custom_games cg
        LEFT JOIN players p ON p.id = cg.created_by AND p.tenant_id = cg.tenant_id
        WHERE cg.tenant_id = $1
        ORDER BY cg.sort_order"#,
    )
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let games: Vec<Value> = rows.iter().map(|(id, title, _tid, classic, sort, active, creator)| {
        json!({"id": id, "title": title, "classic": classic, "sortOrder": sort, "isActive": active, "createdBy": creator})
    }).collect();

    Ok(Json(json!({ "games": games })))
}

pub async fn create_game(
    State(state): State<AppState>,
    player: axum::Extension<AuthPlayer>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<CreateGameRequest>,
) -> AppResult<Json<Value>> {
    let tid = &tenant.0 .0;

    if body.id.is_empty() || body.title.is_empty() {
        return Err(AppError::BadRequest("ID and title required".into()));
    }

    sqlx::query(
        r#"INSERT INTO custom_games (id, tenant_id, title, classic, character_id, mechanic, icon_color, icon_emoji, scene_code, sort_order, created_by, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)"#,
    )
    .bind(&body.id)
    .bind(tid)
    .bind(&body.title)
    .bind(body.classic.unwrap_or(false))
    .bind(&body.character_id)
    .bind(&body.mechanic)
    .bind(&body.icon_color)
    .bind(&body.icon_emoji)
    .bind(&body.scene_code)
    .bind(body.sort_order.unwrap_or(0))
    .bind(player.id)
    .execute(&state.db)
    .await?;

    if let Some(ref cats) = body.categories {
        for (i, cat_id) in cats.iter().enumerate() {
            sqlx::query(
                "INSERT INTO game_category_assignments (tenant_id, game_id, category_id, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
            )
            .bind(tid)
            .bind(&body.id)
            .bind(cat_id)
            .bind(i as i32)
            .execute(&state.db)
            .await?;
        }
    }

    Ok(Json(json!({"id": body.id, "success": true})))
}

pub async fn update_game(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
    Json(body): Json<UpdateGameRequest>,
) -> AppResult<Json<Value>> {
    let tid = &tenant.0 .0;

    // Build dynamic update
    let mut sets = Vec::new();
    if body.title.is_some() { sets.push("title = COALESCE($3, title)"); }
    if body.classic.is_some() { sets.push("classic = COALESCE($4, classic)"); }
    if body.icon_color.is_some() { sets.push("icon_color = COALESCE($5, icon_color)"); }
    if body.icon_emoji.is_some() { sets.push("icon_emoji = COALESCE($6, icon_emoji)"); }
    if body.scene_code.is_some() { sets.push("scene_code = COALESCE($7, scene_code)"); }
    if body.sort_order.is_some() { sets.push("sort_order = COALESCE($8, sort_order)"); }

    if !sets.is_empty() {
        let sql = format!("UPDATE custom_games SET {} WHERE id = $1 AND tenant_id = $2", sets.join(", "));
        sqlx::query(&sql)
            .bind(&id).bind(tid)
            .bind(&body.title).bind(body.classic)
            .bind(&body.icon_color).bind(&body.icon_emoji)
            .bind(&body.scene_code).bind(body.sort_order)
            .execute(&state.db)
            .await?;
    }

    if let Some(ref cats) = body.categories {
        sqlx::query("DELETE FROM game_category_assignments WHERE tenant_id = $1 AND game_id = $2")
            .bind(tid).bind(&id).execute(&state.db).await?;
        for (i, cat_id) in cats.iter().enumerate() {
            sqlx::query(
                "INSERT INTO game_category_assignments (tenant_id, game_id, category_id, sort_order) VALUES ($1, $2, $3, $4)",
            )
            .bind(tid).bind(&id).bind(cat_id).bind(i as i32)
            .execute(&state.db).await?;
        }
    }

    Ok(Json(json!({"success": true})))
}

pub async fn toggle_game(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    sqlx::query("UPDATE custom_games SET is_active = NOT is_active WHERE id = $1 AND tenant_id = $2")
        .bind(&id).bind(&tenant.0 .0)
        .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn delete_game(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let tid = &tenant.0 .0;
    sqlx::query("DELETE FROM game_category_assignments WHERE tenant_id = $1 AND game_id = $2").bind(tid).bind(&id).execute(&state.db).await?;
    sqlx::query("DELETE FROM custom_games WHERE id = $1 AND tenant_id = $2").bind(&id).bind(tid).execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn admin_list_categories(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
) -> AppResult<Json<Value>> {
    let rows: Vec<(String, String, String, Option<String>, i32, bool, i64)> = sqlx::query_as(
        r#"SELECT gc.id, gc.name, gc.slug, gc.icon_emoji, gc.sort_order, gc.is_active,
            (SELECT COUNT(*)::bigint FROM game_category_assignments gca WHERE gca.category_id = gc.id AND gca.tenant_id = gc.tenant_id)
        FROM game_categories gc WHERE gc.tenant_id = $1 ORDER BY gc.sort_order"#,
    )
    .bind(&tenant.0 .0)
    .fetch_all(&state.db)
    .await?;

    let cats: Vec<Value> = rows.iter().map(|(id, name, slug, emoji, sort, active, count)| {
        json!({"id": id, "name": name, "slug": slug, "iconEmoji": emoji, "sortOrder": sort, "isActive": active, "gameCount": count})
    }).collect();

    Ok(Json(json!({ "categories": cats })))
}

pub async fn create_category(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Json(body): Json<CreateCategoryRequest>,
) -> AppResult<Json<Value>> {
    let slug = body.name.to_lowercase().replace(|c: char| !c.is_alphanumeric(), "-");
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO game_categories (id, tenant_id, name, slug, description, icon_emoji, icon_color, sort_order, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)",
    )
    .bind(&id)
    .bind(&tenant.0 .0)
    .bind(&body.name)
    .bind(&slug)
    .bind(&body.description)
    .bind(&body.icon_emoji)
    .bind(&body.icon_color)
    .bind(body.sort_order.unwrap_or(0))
    .execute(&state.db)
    .await?;

    Ok(Json(json!({"id": id, "slug": slug})))
}

pub async fn update_category(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
    Json(body): Json<CreateCategoryRequest>,
) -> AppResult<Json<Value>> {
    let slug = body.name.to_lowercase().replace(|c: char| !c.is_alphanumeric(), "-");
    sqlx::query(
        "UPDATE game_categories SET name = $1, slug = $2, description = $3, icon_emoji = $4, icon_color = $5, sort_order = $6 WHERE id = $7 AND tenant_id = $8",
    )
    .bind(&body.name).bind(&slug).bind(&body.description)
    .bind(&body.icon_emoji).bind(&body.icon_color).bind(body.sort_order.unwrap_or(0))
    .bind(&id).bind(&tenant.0 .0)
    .execute(&state.db).await?;

    Ok(Json(json!({"success": true})))
}

pub async fn delete_category(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    sqlx::query("DELETE FROM game_categories WHERE id = $1 AND tenant_id = $2")
        .bind(&id).bind(&tenant.0 .0)
        .execute(&state.db).await?;
    Ok(Json(json!({"success": true})))
}

pub async fn assign_categories(
    State(state): State<AppState>,
    tenant: axum::Extension<TenantId>,
    Path(id): Path<String>,
    Json(body): Json<AssignCategoriesRequest>,
) -> AppResult<Json<Value>> {
    let tid = &tenant.0 .0;
    sqlx::query("DELETE FROM game_category_assignments WHERE tenant_id = $1 AND game_id = $2")
        .bind(tid).bind(&id).execute(&state.db).await?;

    for cat in &body.categories {
        sqlx::query(
            "INSERT INTO game_category_assignments (tenant_id, game_id, category_id, sort_order) VALUES ($1, $2, $3, $4)",
        )
        .bind(tid).bind(&id).bind(&cat.category_id).bind(cat.sort_order.unwrap_or(0))
        .execute(&state.db).await?;
    }

    Ok(Json(json!({"success": true})))
}
