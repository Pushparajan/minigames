import { useState, useEffect, useRef, type FormEvent } from "react";
import { usePlayerStore } from "../../stores/usePlayerStore";

/* ============================================
   RegisterModal — Create account form
   ============================================ */

interface RegisterModalProps {
  open: boolean;
  onClose: () => void;
  onSwitchToLogin: () => void;
}

export default function RegisterModal({
  open,
  onClose,
  onSwitchToLogin,
}: RegisterModalProps) {
  const { register } = usePlayerStore();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError("");
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await register(email.trim(), password, displayName.trim());
      setDisplayName("");
      setEmail("");
      setPassword("");
      onClose();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Registration failed";
      setError(msg);
    } finally {
      setSubmitting(false);
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
        aria-labelledby="modal-register-title"
      >
        <h2 id="modal-register-title">Create Account</h2>

        <form onSubmit={handleSubmit}>
          <label htmlFor="reg-name" className="sr-only">
            Display Name
          </label>
          <input
            ref={nameRef}
            id="reg-name"
            type="text"
            placeholder="Display Name"
            required
            minLength={2}
            maxLength={30}
            autoComplete="username"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <label htmlFor="reg-email" className="sr-only">
            Email
          </label>
          <input
            id="reg-email"
            type="email"
            placeholder="Email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label htmlFor="reg-password" className="sr-only">
            Password (minimum 8 characters)
          </label>
          <input
            id="reg-password"
            type="password"
            placeholder="Password (min 8 chars)"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && (
            <div className="form-error" role="alert" aria-live="assertive">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary btn-full"
            disabled={submitting}
          >
            {submitting ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="modal-switch">
          Have an account?{" "}
          <a
            href="#login"
            onClick={(e) => {
              e.preventDefault();
              onSwitchToLogin();
            }}
          >
            Log in
          </a>
        </p>

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
