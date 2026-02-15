import { useEffect, useState, useCallback } from "react";
import api from "../../api/client";
import type { BillingStatus } from "../../types";

/* ============================================
   BillingModal — Current subscription status
   ============================================ */

interface BillingModalProps {
  open: boolean;
  onClose: () => void;
  onShowPlans: () => void;
}

export default function BillingModal({
  open,
  onClose,
  onShowPlans,
}: BillingModalProps) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getBillingStatus();
      setStatus(res);
    } catch {
      setError("Failed to load billing info.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadStatus();
  }, [open, loadStatus]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sub = status?.subscription;
  const hasSub = sub !== null && sub !== undefined;
  const orgId = status?.organisationId ?? "";

  async function handleCancel() {
    if (
      !window.confirm(
        "Cancel your subscription? It will remain active until the end of the billing period.",
      )
    )
      return;

    try {
      await api.cancelSubscription(orgId, false);
      await loadStatus();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Cancellation failed";
      alert(msg);
    }
  }

  async function handleResume() {
    try {
      await api.resumeSubscription(orgId);
      await loadStatus();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Resume failed";
      alert(msg);
    }
  }

  async function handlePortal() {
    try {
      const res = await api.billingPortal(
        orgId,
        window.location.origin + "/billing",
      );
      if (res.url) window.location.href = res.url;
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Could not open billing portal";
      alert(msg);
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-billing-title"
      >
        <h2 id="modal-billing-title">My Subscription</h2>

        {loading && (
          <div style={{ textAlign: "center", color: "#a0a0c0", padding: "30px" }}>
            Loading...
          </div>
        )}

        {error && (
          <div style={{ textAlign: "center", color: "#ef5350", padding: "30px" }}>
            {error}
          </div>
        )}

        {!loading && !error && hasSub && sub && (
          <div>
            <div className="billing-row">
              <span>Plan</span>
              <strong>
                {(sub.planTier ?? status?.plan ?? "free").toUpperCase()}
              </strong>
            </div>
            <div className="billing-row">
              <span>Status</span>
              <strong>{sub.status}</strong>
            </div>
            {sub.trialEnd && (
              <div className="billing-row">
                <span>Trial ends</span>
                <strong>
                  {new Date(sub.trialEnd).toLocaleDateString()}
                </strong>
              </div>
            )}
            {sub.currentPeriodEnd && (
              <div className="billing-row">
                <span>Period ends</span>
                <strong>
                  {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                </strong>
              </div>
            )}

            <div className="billing-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={handlePortal}
              >
                Manage in Stripe
              </button>
              {sub.cancelAtPeriodEnd ? (
                <button
                  type="button"
                  className="btn-outline"
                  onClick={handleResume}
                >
                  Resume Subscription
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-outline btn-danger"
                  onClick={handleCancel}
                >
                  Cancel Subscription
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && !error && !hasSub && (
          <div style={{ textAlign: "center", padding: "20px" }}>
            <p style={{ color: "#a0a0c0", marginBottom: "16px" }}>
              You are on the <strong>Free</strong> plan.
            </p>
            <button
              type="button"
              className="btn-primary btn-full"
              onClick={() => {
                onClose();
                onShowPlans();
              }}
            >
              View Plans
            </button>
          </div>
        )}

        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
