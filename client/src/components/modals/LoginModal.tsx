import { useState, useEffect, useRef, type FormEvent } from "react";
import { usePlayerStore } from "../../stores/usePlayerStore";

/* ============================================
   LoginModal — Email + password login form
   ============================================ */

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSwitchToRegister: () => void;
}

export default function LoginModal({
  open,
  onClose,
  onSwitchToRegister,
}: LoginModalProps) {
  const { login } = usePlayerStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // Focus first input when opened
  useEffect(() => {
    if (open) {
      setError("");
      setTimeout(() => emailRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape
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
      await login(email.trim(), password);
      setEmail("");
      setPassword("");
      onClose();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Login failed";
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
        aria-labelledby="modal-login-title"
      >
        <h2 id="modal-login-title">Log In</h2>

        <form onSubmit={handleSubmit}>
          <label htmlFor="login-email" className="sr-only">
            Email
          </label>
          <input
            ref={emailRef}
            id="login-email"
            type="email"
            placeholder="Email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label htmlFor="login-password" className="sr-only">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            placeholder="Password"
            required
            autoComplete="current-password"
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
            {submitting ? "Logging in..." : "Log In"}
          </button>
        </form>

        <p className="modal-switch">
          No account?{" "}
          <a
            href="#register"
            onClick={(e) => {
              e.preventDefault();
              onSwitchToRegister();
            }}
          >
            Sign up
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
