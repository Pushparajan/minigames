import { usePlayerStore } from "../stores/usePlayerStore";
import { Link } from "react-router-dom";

/* ============================================
   NavBar — Top navigation bar
   ============================================ */

interface NavBarProps {
  onShowPlans: () => void;
  onShowLogin: () => void;
  onShowRegister: () => void;
  onShowBilling: () => void;
  onShowLobby: () => void;
}

export default function NavBar({
  onShowPlans,
  onShowLogin,
  onShowRegister,
  onShowBilling,
  onShowLobby,
}: NavBarProps) {
  const { player, isAuthenticated, logout } = usePlayerStore();

  return (
    <nav id="top-nav" aria-label="Main navigation">
      <div className="nav-left">
        <Link to="/" className="nav-brand">
          STEM School Adventures
        </Link>
      </div>

      <div className="nav-right">
        <button
          type="button"
          className="nav-link"
          onClick={onShowPlans}
        >
          Plans
        </button>

        {!isAuthenticated ? (
          <div className="nav-auth">
            <button
              type="button"
              className="btn-outline"
              onClick={onShowLogin}
            >
              Log In
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={onShowRegister}
            >
              Sign Up
            </button>
          </div>
        ) : (
          <div className="nav-auth">
            <button
              type="button"
              className="nav-link"
              onClick={onShowLobby}
            >
              Multiplayer
            </button>

            {player?.adminRole && (
              <Link to="/admin" className="nav-link">
                Admin
              </Link>
            )}

            <button
              type="button"
              className="nav-link"
              onClick={onShowBilling}
            >
              Billing
            </button>

            <span className="nav-username">
              {player?.displayName ?? "Player"}
            </span>

            <button
              type="button"
              className="btn-outline btn-sm"
              onClick={logout}
            >
              Log Out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
