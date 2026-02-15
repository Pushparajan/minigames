import { useGameStore } from "../stores/useGameStore";

/* ============================================
   GameGrid — Game launcher grid with categories
   ============================================ */

interface GameGridProps {
  onSelectGame: (gameId: string) => void;
}

export default function GameGrid({ onSelectGame }: GameGridProps) {
  const { categories, activeCategory, progress, loading, setCategory, getFilteredGames } =
    useGameStore();

  const filteredGames = getFilteredGames();

  function renderStars(stars: number) {
    const items = [];
    for (let i = 0; i < 3; i++) {
      items.push(
        <span
          key={i}
          className={`star ${i < stars ? "star-earned" : "star-empty"}`}
          aria-hidden="true"
        >
          {i < stars ? "\u2605" : "\u2606"}
        </span>,
      );
    }
    return items;
  }

  return (
    <main id="launcher">
      <header className="launcher-header">
        <h1 tabIndex={-1}>STEM School Adventures</h1>
        <p className="subtitle">25 Classic Games Reimagined for Learning</p>
      </header>

      {/* Category filter tabs */}
      <nav
        id="category-filters"
        className="category-filters"
        aria-label="Game categories"
      >
        <button
          type="button"
          className={`category-tab${activeCategory === null ? " category-tab-active" : ""}`}
          onClick={() => setCategory(null)}
        >
          All Games
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`category-tab${activeCategory === cat.slug || activeCategory === cat.id ? " category-tab-active" : ""}`}
            onClick={() => setCategory(cat.slug ?? cat.id)}
          >
            <span className="category-tab-icon" aria-hidden="true">
              {cat.icon_emoji}
            </span>{" "}
            {cat.name}
          </button>
        ))}
      </nav>

      {/* Game card grid */}
      {loading ? (
        <p style={{ textAlign: "center", color: "#a0a0c0", padding: "2rem" }}>
          Loading games...
        </p>
      ) : (
        <section
          id="game-grid"
          className="game-grid"
          aria-label="Game library"
          role="list"
        >
          {filteredGames.map((game, idx) => {
            const prog = progress[game.id];
            const stars = prog?.stars ?? 0;
            const highScore = prog?.highScore ?? 0;

            return (
              <div
                key={game.id}
                className="game-card"
                role="listitem"
                tabIndex={0}
                onClick={() => onSelectGame(game.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectGame(game.id);
                  }
                }}
                aria-label={`${game.title} - ${game.mechanic}`}
              >
                <span className="card-number" aria-hidden="true">
                  #{idx + 1}
                </span>
                <div
                  className="card-icon"
                  style={{ background: game.iconColor }}
                  aria-hidden="true"
                >
                  {game.iconEmoji}
                </div>
                <h3>{game.title}</h3>
                <div className="card-character">{game.character}</div>
                <div className="card-stars" aria-label={`${stars} of 3 stars`}>
                  {renderStars(stars)}
                </div>
                {highScore > 0 && (
                  <div className="card-highscore">
                    Best: {highScore.toLocaleString()}
                  </div>
                )}
                <div className="card-mechanic">{game.mechanic}</div>
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}
