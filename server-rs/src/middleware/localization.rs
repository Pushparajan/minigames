use axum::{
    extract::Request,
    middleware::Next,
    response::Response,
};

use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct LocaleInfo {
    pub locale: String,
    pub currency: String,
    pub currency_symbol: String,
    pub currency_position: String, // "before" or "after"
    pub decimal_places: u32,
    pub region: String,
}

impl Default for LocaleInfo {
    fn default() -> Self {
        Self {
            locale: "en-US".to_string(),
            currency: "USD".to_string(),
            currency_symbol: "$".to_string(),
            currency_position: "before".to_string(),
            decimal_places: 2,
            region: "us-east".to_string(),
        }
    }
}

fn locale_config(locale: &str) -> LocaleInfo {
    match locale {
        "es-ES" => LocaleInfo {
            locale: "es-ES".into(),
            currency: "EUR".into(),
            currency_symbol: "€".into(),
            currency_position: "after".into(),
            decimal_places: 2,
            region: "eu-west".into(),
        },
        "fr-FR" => LocaleInfo {
            locale: "fr-FR".into(),
            currency: "EUR".into(),
            currency_symbol: "€".into(),
            currency_position: "after".into(),
            decimal_places: 2,
            region: "eu-west".into(),
        },
        "de-DE" => LocaleInfo {
            locale: "de-DE".into(),
            currency: "EUR".into(),
            currency_symbol: "€".into(),
            currency_position: "after".into(),
            decimal_places: 2,
            region: "eu-west".into(),
        },
        "pt-BR" => LocaleInfo {
            locale: "pt-BR".into(),
            currency: "BRL".into(),
            currency_symbol: "R$".into(),
            currency_position: "before".into(),
            decimal_places: 2,
            region: "us-east".into(),
        },
        "ja-JP" => LocaleInfo {
            locale: "ja-JP".into(),
            currency: "JPY".into(),
            currency_symbol: "¥".into(),
            currency_position: "before".into(),
            decimal_places: 0,
            region: "asia-east".into(),
        },
        "ko-KR" => LocaleInfo {
            locale: "ko-KR".into(),
            currency: "KRW".into(),
            currency_symbol: "₩".into(),
            currency_position: "before".into(),
            decimal_places: 0,
            region: "asia-east".into(),
        },
        "zh-CN" => LocaleInfo {
            locale: "zh-CN".into(),
            currency: "CNY".into(),
            currency_symbol: "¥".into(),
            currency_position: "before".into(),
            decimal_places: 2,
            region: "asia-east".into(),
        },
        "hi-IN" => LocaleInfo {
            locale: "hi-IN".into(),
            currency: "INR".into(),
            currency_symbol: "₹".into(),
            currency_position: "before".into(),
            decimal_places: 2,
            region: "asia-south".into(),
        },
        _ => LocaleInfo::default(),
    }
}

fn detect_locale(req: &Request) -> String {
    // Check query param first
    if let Some(query) = req.uri().query() {
        for pair in query.split('&') {
            let mut kv = pair.splitn(2, '=');
            if kv.next() == Some("locale") {
                if let Some(val) = kv.next() {
                    return val.to_string();
                }
            }
        }
    }

    // Check Accept-Language header
    if let Some(al) = req.headers().get("accept-language").and_then(|v| v.to_str().ok()) {
        // Parse first language tag
        if let Some(lang) = al.split(',').next() {
            let tag = lang.split(';').next().unwrap_or("en-US").trim();
            return tag.to_string();
        }
    }

    "en-US".to_string()
}

/// Middleware: detects locale and attaches LocaleInfo to request.
pub async fn locale_detector(
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let locale = detect_locale(&req);
    let info = locale_config(&locale);
    req.extensions_mut().insert(info);
    Ok(next.run(req).await)
}

pub fn format_currency(amount_cents: i64, info: &LocaleInfo) -> String {
    let divisor = if info.decimal_places == 0 { 1.0 } else { 100.0 };
    let val = amount_cents as f64 / divisor;
    let formatted = if info.decimal_places == 0 {
        format!("{}", val as i64)
    } else {
        format!("{:.width$}", val, width = info.decimal_places as usize)
    };
    if info.currency_position == "before" {
        format!("{}{}", info.currency_symbol, formatted)
    } else {
        format!("{} {}", formatted, info.currency_symbol)
    }
}
