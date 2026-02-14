use crate::config::StripeConfig;
use crate::error::{AppError, AppResult};
use serde_json::Value;

/// Lightweight Stripe client wrapping raw HTTP calls.
/// This avoids compile-time complexity of async-stripe while providing
/// all the Stripe operations needed by the application.
#[derive(Clone)]
pub struct StripeClient {
    secret_key: String,
    webhook_secret: String,
    client: reqwest::Client,
}

impl StripeClient {
    pub fn new(config: &StripeConfig) -> Option<Self> {
        if config.secret_key.is_empty() {
            return None;
        }
        Some(Self {
            secret_key: config.secret_key.clone(),
            webhook_secret: config.webhook_secret.clone(),
            client: reqwest::Client::new(),
        })
    }

    async fn post(&self, path: &str, params: &[(&str, &str)]) -> AppResult<Value> {
        let url = format!("https://api.stripe.com/v1{}", path);
        let resp = self
            .client
            .post(&url)
            .basic_auth(&self.secret_key, Option::<&str>::None)
            .form(params)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Stripe request failed: {}", e)))?;

        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("Stripe response parse failed: {}", e)))?;

        if !status.is_success() {
            let msg = body["error"]["message"]
                .as_str()
                .unwrap_or("Unknown Stripe error");
            return Err(AppError::Internal(format!("Stripe error: {}", msg)));
        }
        Ok(body)
    }

    async fn get(&self, path: &str) -> AppResult<Value> {
        let url = format!("https://api.stripe.com/v1{}", path);
        let resp = self
            .client
            .get(&url)
            .basic_auth(&self.secret_key, Option::<&str>::None)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Stripe request failed: {}", e)))?;

        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("Stripe response parse failed: {}", e)))?;

        if !status.is_success() {
            let msg = body["error"]["message"]
                .as_str()
                .unwrap_or("Unknown Stripe error");
            return Err(AppError::Internal(format!("Stripe error: {}", msg)));
        }
        Ok(body)
    }

    async fn delete(&self, path: &str) -> AppResult<Value> {
        let url = format!("https://api.stripe.com/v1{}", path);
        let resp = self
            .client
            .delete(&url)
            .basic_auth(&self.secret_key, Option::<&str>::None)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Stripe request failed: {}", e)))?;

        let body: Value = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("Stripe response parse failed: {}", e)))?;
        Ok(body)
    }

    pub async fn create_customer(
        &self,
        email: &str,
        name: &str,
        org_id: &str,
    ) -> AppResult<Value> {
        self.post(
            "/customers",
            &[
                ("email", email),
                ("name", name),
                ("metadata[organisationId]", org_id),
            ],
        )
        .await
    }

    pub async fn create_subscription(
        &self,
        customer_id: &str,
        price_id: &str,
        trial_days: Option<u32>,
        org_id: &str,
        tenant_id: &str,
    ) -> AppResult<Value> {
        let trial_str = trial_days.map(|d| d.to_string()).unwrap_or_default();
        let mut params: Vec<(&str, &str)> = vec![
            ("customer", customer_id),
            ("items[0][price]", price_id),
            ("metadata[organisationId]", org_id),
            ("metadata[tenantId]", tenant_id),
        ];
        if trial_days.is_some() {
            params.push(("trial_period_days", &trial_str));
        }
        self.post("/subscriptions", &params).await
    }

    pub async fn cancel_subscription(
        &self,
        subscription_id: &str,
        immediate: bool,
    ) -> AppResult<Value> {
        if immediate {
            self.delete(&format!("/subscriptions/{}", subscription_id))
                .await
        } else {
            self.post(
                &format!("/subscriptions/{}", subscription_id),
                &[("cancel_at_period_end", "true")],
            )
            .await
        }
    }

    pub async fn resume_subscription(&self, subscription_id: &str) -> AppResult<Value> {
        self.post(
            &format!("/subscriptions/{}", subscription_id),
            &[("cancel_at_period_end", "false")],
        )
        .await
    }

    pub async fn get_subscription(&self, subscription_id: &str) -> AppResult<Value> {
        self.get(&format!("/subscriptions/{}", subscription_id))
            .await
    }

    pub async fn create_billing_portal(
        &self,
        customer_id: &str,
        return_url: &str,
    ) -> AppResult<Value> {
        self.post(
            "/billing_portal/sessions",
            &[("customer", customer_id), ("return_url", return_url)],
        )
        .await
    }

    pub fn verify_webhook_signature(
        &self,
        payload: &[u8],
        signature_header: &str,
    ) -> AppResult<Value> {
        // Parse Stripe signature header: t=timestamp,v1=signature
        let mut timestamp = "";
        let mut sig = "";
        for part in signature_header.split(',') {
            let mut kv = part.splitn(2, '=');
            match kv.next() {
                Some("t") => timestamp = kv.next().unwrap_or(""),
                Some("v1") => sig = kv.next().unwrap_or(""),
                _ => {}
            }
        }

        if timestamp.is_empty() || sig.is_empty() {
            return Err(AppError::BadRequest(
                "Invalid Stripe signature".into(),
            ));
        }

        // Verify HMAC-SHA256
        use hmac::{Hmac, Mac};
        use sha2::Sha256;

        type HmacSha256 = Hmac<Sha256>;

        let signed_payload = format!("{}.{}", timestamp, String::from_utf8_lossy(payload));
        let mut mac = HmacSha256::new_from_slice(self.webhook_secret.as_bytes())
            .map_err(|_| AppError::Internal("HMAC key error".into()))?;
        mac.update(signed_payload.as_bytes());

        let expected = hex::encode(mac.finalize().into_bytes());
        if expected != sig {
            return Err(AppError::BadRequest(
                "Webhook signature verification failed".into(),
            ));
        }

        // Check timestamp is within 5 minutes
        let ts: i64 = timestamp.parse().unwrap_or(0);
        let now = chrono::Utc::now().timestamp();
        if (now - ts).abs() > 300 {
            return Err(AppError::BadRequest("Webhook timestamp too old".into()));
        }

        serde_json::from_slice(payload)
            .map_err(|e| AppError::BadRequest(format!("Invalid webhook payload: {}", e)))
    }
}
