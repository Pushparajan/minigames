import { useEffect } from "react";
import type { PlanTier } from "../../types";

/* ============================================
   PlansModal — Subscription tier display
   ============================================ */

const PLANS: PlanTier[] = [
  {
    name: "Free",
    price: "$0",
    tier: "free",
    features: [
      "1 member",
      "50 MB storage",
      "5 games",
      "Local save progress",
      "View leaderboards",
    ],
  },
  {
    name: "Starter",
    price: "$19.99",
    period: "/mo",
    tier: "starter",
    featured: true,
    features: [
      "5 members",
      "500 MB storage",
      "25 games",
      "Cloud sync & backup",
      "Submit to leaderboards",
      "Comments & reviews",
    ],
  },
  {
    name: "Pro",
    price: "$49.99",
    period: "/mo",
    tier: "pro",
    features: [
      "25 members",
      "2 GB storage",
      "Unlimited games",
      "Create organisations",
      "Priority support",
      "Advanced analytics",
    ],
  },
  {
    name: "Enterprise",
    price: "$149.99",
    period: "/mo",
    tier: "enterprise",
    features: [
      "Unlimited members",
      "Unlimited storage",
      "Unlimited games",
      "Custom branding",
      "Dedicated support",
      "SLA guarantee",
    ],
  },
];

interface PlansModalProps {
  open: boolean;
  onClose: () => void;
  onSubscribe: (tier: string) => void;
  currentTier?: string;
}

export default function PlansModal({
  open,
  onClose,
  onSubscribe,
  currentTier,
}: PlansModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-plans-title"
      >
        <h2 id="modal-plans-title">Subscription Plans</h2>

        <div className="plans-grid">
          {PLANS.map((plan) => {
            const isCurrent =
              currentTier?.toLowerCase() === plan.tier;

            return (
              <div
                key={plan.tier}
                className={`plan-card${plan.featured ? " plan-featured" : ""}`}
              >
                {plan.featured && (
                  <span className="plan-badge">Popular</span>
                )}
                <h3>{plan.name}</h3>
                <div className="plan-price">
                  {plan.price}
                  {plan.period && <span>{plan.period}</span>}
                </div>
                <ul>
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {isCurrent ? (
                  <button
                    type="button"
                    className="btn-outline btn-full"
                    disabled
                  >
                    Current
                  </button>
                ) : plan.tier === "free" ? (
                  <button
                    type="button"
                    className="btn-outline btn-full"
                    disabled
                  >
                    Free
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-primary btn-full"
                    onClick={() => onSubscribe(plan.tier)}
                  >
                    Subscribe
                  </button>
                )}
              </div>
            );
          })}
        </div>

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
