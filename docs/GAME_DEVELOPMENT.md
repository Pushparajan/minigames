# Game Development Guide

## Overview

This guide covers how to create new Phaser 3 game scenes for the STEM School Adventures platform. Each game is a self-contained Phaser Scene that registers itself with `GameRegistry`, uses procedural graphics rendering (no sprite sheets), and integrates with the platform's score and save systems through the `Launcher`.

---

## Game Registration

Every game must register with `GameRegistry` so the platform can discover it, display it in the game grid, and launch it. Registration happens at the bottom of your game file, after the class definition.

```javascript
class MyGame extends Phaser.Scene {
    constructor() {
        super({ key: 'MyGame' });
    }

    create() {
        // Set up background, player, enemies, HUD
    }

    update() {
        // Main game loop: move entities, check collisions, update HUD
    }

    shutdown() {
        // REQUIRED: Reset all arrays to prevent memory leaks
        this.bullets = [];
        this.enemies = [];
        this.particles = [];
    }
}

GameRegistry.register({
    id: 'MyGame',              // Unique scene key (must match super({ key }))
    title: 'My Game',          // Display name shown on the game card
    classic: 'Reference Game', // Classic game it's inspired by
    character: 'guha',         // Character sprite (guha, principal, nadia, etc.)
    mechanic: 'Short description of gameplay',
    iconColor: '#333',         // Card background color (hex)
    iconEmoji: '🎮',           // Card icon (emoji)
    scene: MyGame,             // Scene class reference
    physics: 'matter'          // Optional: 'matter' | 'arcade' | omit for none
});
```

### Registration Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique scene key. Must match the key passed to `super()`. |
| `title` | Yes | Human-readable display name for the game card. |
| `classic` | Yes | The classic game this is inspired by. |
| `character` | Yes | Character sprite identifier (see [Character Sprites](#character-sprites)). |
| `mechanic` | Yes | Short description of the core gameplay mechanic. |
| `iconColor` | Yes | Hex color for the game card background. |
| `iconEmoji` | Yes | Emoji displayed on the game card. |
| `scene` | Yes | Reference to the Phaser.Scene class. |
| `physics` | No | Physics engine: `'matter'`, `'arcade'`, or omit for none. |

---

## Physics Configuration

Most games in the platform use **manual physics** -- they implement their own gravity, velocity, and collision logic directly in the `update()` loop. This is the default and recommended approach.

- **No physics** (default): Manual gravity and velocity calculations. Used by the vast majority of games. Gives you full control over movement and collision behavior.
- **`'matter'`**: Matter.js physics engine. Provides realistic rigid-body simulation with proper collision response, friction, and restitution. Only used by `PhysicsMasterBilliards` for realistic pool ball physics.
- **`'arcade'`**: Phaser Arcade physics. Lightweight axis-aligned bounding box (AABB) collision detection. Suitable for simple overlap and separation needs.

**Important:** Physics engines are loaded conditionally per-game in `Launcher.js`. Only specify the `physics` field if your game truly needs an engine. Adding unnecessary physics increases load time and memory usage.

---

## Scene Lifecycle

### `create()`

This method is called once when the scene starts. Use it to set up everything your game needs:

- Draw the background (static -- done once, not every frame)
- Create the player sprite
- Spawn initial enemies or obstacles
- Set up the HUD (score text, instructions, status indicators)
- Register input handlers (keyboard, mouse/touch)
- Initialize arrays for dynamic entities (bullets, enemies, particles)
- Create graphics layers with `.setDepth()` for proper z-ordering

```javascript
create() {
    const { width, height } = this.scale;

    // Static background
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x16213e, 0x16213e, 1);
    bg.fillRect(0, 0, width, height);

    // Entity arrays
    this.bullets = [];
    this.enemies = [];
    this.particles = [];

    // Graphics layers
    this.bulletGraphics = this.add.graphics().setDepth(6);
    this.enemyGraphics = this.add.graphics().setDepth(4);

    // HUD
    this.score = 0;
    this.scoreText = this.add.text(10, 10, 'Score: 0', {
        fontSize: '13px', color: '#E53935', fontFamily: 'sans-serif'
    }).setDepth(10);

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
}
```

### `update()`

The main game loop, called at 60fps. This is where all per-frame logic runs:

- Move entities (apply velocity, gravity)
- Check collisions between entities
- Spawn new enemies or obstacles
- Update the HUD when values change
- Draw dynamic entities to their graphics layers

**Performance tips:**

- Only call `Launcher.updateScore()` when the score actually changes -- avoid calling it every frame.
- Do not redraw static backgrounds every frame. Draw them once in `create()`.
- Use `this.time.now` instead of `Date.now()` for consistency with Phaser's internal clock.
- Use binary search for sorted data lookups (O(log n) vs O(n)).
- Iterate arrays in reverse when splicing elements (see [Entity Management](#entity-management)).

### `shutdown()`

Called when the player switches to a different game. **This method is required** -- failing to reset arrays here causes memory leaks, since entity references persist across scene restarts.

```javascript
shutdown() {
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
}
```

Reset every array and any other accumulated state (timers, intervals, etc.) in this method.

---

## Character Sprites

Use `CharacterFactory` to create character textures from the SVG sprites in `assets/svg/`. The factory renders the SVG at the requested scale and returns a texture key you can use with Phaser's image system.

```javascript
const charKey = CharacterFactory.createTexture(this, 'guha', 2); // scale 2x
this.playerSprite = this.add.image(x, y, charKey);
```

Available characters are defined as SVG files in the `assets/svg/` directory. The `character` field in your `GameRegistry.register()` call determines which character is associated with your game on the card display.

Characters used across the existing games include: `guha`, `nadia`, `zack`, `sofia`, `andres`, `maya`, `dev`, `logicron`, `grandpaVidur`, and `sofia_vs_rex` (dual character).

---

## Score System

### Reporting Score During Gameplay

Update the HUD and notify the Launcher only when the score changes. This avoids unnecessary DOM updates on every frame.

```javascript
// In update()
const newScore = calculateScore();
if (newScore !== this.score) {
    this.score = newScore;
    Launcher.updateScore(this.score);
}
```

### Saving Score on Game End

When the game ends (player dies, time runs out, etc.), save the final score:

```javascript
Launcher.saveGameScore('MyGame', this.score);
```

### Star Thresholds

Stars (0 to 3) are calculated in `SaveManager` based on per-game score thresholds. When adding a new game, define your thresholds:

```javascript
// In SaveManager._starThresholds
MyGame: [100, 500, 1500]  // 1 star at 100+, 2 stars at 500+, 3 stars at 1500+
```

Choose thresholds that represent meaningful skill progression: the first star should be achievable by a beginner within a few attempts, the second star should require solid play, and the third star should reward mastery.

---

## Graphics Rendering

Games use Phaser's `Graphics` object for all rendering -- there are no external sprite sheets or image assets beyond the character SVGs. This keeps the platform lightweight and allows procedural drawing.

### Graphics Layers

Create separate graphics objects for different entity types, each with a depth value for z-ordering:

```javascript
// In create()
this.bulletGraphics = this.add.graphics().setDepth(6);
this.enemyGraphics = this.add.graphics().setDepth(4);
this.particleGraphics = this.add.graphics().setDepth(7);
```

### Drawing Entities

Clear and redraw dynamic graphics every frame in `update()`:

```javascript
// In update()
this.bulletGraphics.clear();
for (const b of this.bullets) {
    this.bulletGraphics.fillStyle(0xFFEB3B, 1);
    this.bulletGraphics.fillCircle(b.x, b.y, 3);
}
```

### Static Backgrounds

Draw backgrounds once in `create()` -- never in `update()`:

```javascript
create() {
    const { width, height } = this.scale;
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x16213e, 0x16213e, 1);
    bg.fillRect(0, 0, width, height);
}
```

### Depth Ordering

Use `.setDepth()` for consistent, predictable layering across all games:

| Depth Range | Usage |
|-------------|-------|
| 0 - 2 | Background elements |
| 3 - 4 | Enemies, obstacles |
| 5 | Player |
| 6 - 7 | Bullets, particles |
| 10 | HUD text (score, status) |
| 20 | Game over overlay |

---

## Input Handling

### Keyboard

```javascript
// Cursor keys (arrows)
this.cursors = this.input.keyboard.createCursorKeys();

// WASD keys
this.wasd = this.input.keyboard.addKeys({
    w: 'W', a: 'A', s: 'S', d: 'D'
});

// Specific key events
this.input.keyboard.on('keydown-SPACE', () => this._shoot());
```

### Mouse and Touch

```javascript
// Click or tap
this.input.on('pointerdown', (pointer) => {
    // pointer.x, pointer.y for position
});

// Hover or drag
this.input.on('pointermove', (pointer) => {
    // pointer.x, pointer.y for current position
});
```

Both mouse and touch events fire through the same `pointer` API, so your games automatically support both desktop and mobile input.

---

## Collision Detection

Since most games use manual physics, you need to implement your own collision checks.

### Circle-Based Collision

Best for round entities (bullets, balls, particles):

```javascript
const dx = a.x - b.x;
const dy = a.y - b.y;
if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
    // collision!
}
```

### Box-Based Collision

Best for rectangular entities or quick approximations:

```javascript
if (Math.abs(a.x - b.x) < size && Math.abs(a.y - b.y) < size) {
    // collision!
}
```

For performance-critical cases with many entities, consider spatial partitioning or limiting collision checks to entities within a reasonable range.

---

## Entity Management

Use plain arrays to store dynamic entities (bullets, enemies, particles). When removing entities during iteration, always iterate in **reverse** to avoid index-skipping bugs:

```javascript
for (let i = this.bullets.length - 1; i >= 0; i--) {
    const b = this.bullets[i];

    // Update position
    b.x += b.vx;
    b.y += b.vy;
    b.life--;

    // Remove expired bullets
    if (b.life <= 0) {
        this.bullets.splice(i, 1);
        continue;
    }

    // Draw
    this.bulletGraphics.fillStyle(0xFFEB3B, 1);
    this.bulletGraphics.fillCircle(b.x, b.y, 3);
}
```

**Why reverse iteration?** When you `splice(i, 1)` from an array, all elements after index `i` shift down by one. If you iterate forward, you skip the element that moved into position `i`. Iterating backward avoids this because the shifted elements are all at indices you have already processed.

---

## Particle Effects

Particles add visual feedback for explosions, pickups, and impacts. Spawn a burst of small objects with random velocities and a limited lifetime:

```javascript
_spawnParticle(x, y, color) {
    for (let i = 0; i < 6; i++) {
        this.particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            life: 20,
            color
        });
    }
}
```

In `update()`, process particles the same way as other entities -- update position, decrement life, remove when expired, and draw to a dedicated graphics layer.

**Tip:** Keep particle counts reasonable. Spawning too many particles with long lifetimes will degrade performance. A burst of 4-8 particles with 15-25 frame lifetimes works well for most effects.

---

## Game Categories

Games can be assigned to categories via the admin panel or the API. Categories are loaded from `/api/v1/games/categories` and used for filtering in the game grid. When creating a new game, coordinate with the platform admin to assign appropriate categories.

---

## HUD Pattern

Display score and status information at the top of the screen, and instructions at the bottom:

```javascript
// Score and status (top-left)
this.scoreText = this.add.text(10, 10, 'Score: 0', {
    fontSize: '13px',
    color: '#E53935',
    fontFamily: 'sans-serif'
}).setDepth(10);

// Instructions (bottom-center)
this.add.text(width / 2, height - 15, 'Click to shoot | WASD to move', {
    fontSize: '11px',
    color: '#555588',
    fontFamily: 'sans-serif'
}).setOrigin(0.5);
```

Use `.setDepth(10)` for HUD elements so they always render above game content.

---

## Game Over Pattern

When the player's health reaches zero or the game ends, display a game over message, save the score, and pause the scene:

```javascript
if (this.hp <= 0) {
    const { width, height } = this.scale;

    this.add.text(width / 2, height / 2, 'GAME OVER', {
        fontSize: '32px',
        color: '#E53935',
        fontFamily: 'sans-serif',
        fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(20);

    Launcher.saveGameScore('MyGame', this.score);
    this.scene.pause();
}
```

Use `.setDepth(20)` for the overlay so it renders above everything else, including HUD text.

---

## Existing Games

The platform currently includes 25 games. Study these as reference implementations when building new games:

| Game | Classic Inspiration | Character | Mechanic |
|------|-------------------|-----------|----------|
| **AeroEngineering** | Radical Aces | guha | Top-down flight with 360-degree rotation |
| **CableCarConundrum** | Skywire | nadia | Velocity-based momentum on spline path |
| **CampusDash** | On the Run | nadia | Pseudo-3D sprite scaling with high-speed racing |
| **CampusGuard** | Canyon Defense | dev | Tower defense with pathfinding and range turrets |
| **ChemistryEscape** | Acid Factory | andres | Platformer with hazard tiles and chemical key-locks |
| **ColorLabQuest** | Red Beard | andres | Color-matching platforming (matching color only) |
| **DemoDay** | Rubble Trouble | sofia | Precision explosives and structural collapse physics |
| **DroneDefense** | Heli Attack | guha | 360-degree aiming and gravity-based jetpack |
| **FindThePrincipal** | Save the Sheriff | guha | Platforming with enemy stomp and ladder logic |
| **FormulaSTEM** | Turbo Racing | zack | Top-down drifting physics with waypoint racing |
| **GeologyDeepDive** | Motherload | maya | Procedural tile digging and fuel/resource management |
| **GravityShiftRun** | Gravity Guy | zack | One-touch flip-gravity with obstacle collision |
| **HeavyGearDelivery** | Monster Truck | sofia | Suspension physics with cargo-balance condition |
| **HistoryVaultEscape** | Pharaoh's Tomb | grandpaVidur | Grid-based puzzle with traps and switches |
| **HydroLogicPuzzles** | Aqua Energizer | logicron | Sokoban-style push mechanics with gravity orbs |
| **LabBreach** | Commando 2 | zack | Side-scrolling run-and-gun with holographic projectiles |
| **LogicronsGridShift** | Bloxorz | logicron | 3D-to-2D grid movement with edge-fall detection |
| **MolecularSplit** | Bubble Trouble | andres | Vertical harpoon splits circles into smaller sizes |
| **ParkourLab** | Free Running | zack | Momentum-based timing jumps with stumble frames |
| **PhysicsMasterBilliards** | 8 Ball Pool | guha | Matter.js physics with power-drag aiming logic |
| **RobotRepairBay** | Zombieworks | logicron | Connect-the-pipes fluid logic to reboot robots |
| **RoverFieldTest** | Dune Buggy | maya | 2D wheel-joint physics with terrain following |
| **SafetyFirstDefense** | Bush Shoot-Out | sofia | Point-and-click duck-and-cover shooting |
| **STEMCelebration** | Dancing Bush | dev | Rhythm-based input matching with timing windows |
| **STEMProjectVolley** | Raft Wars | sofia_vs_rex | Turn-based projectile arcs with destructible platforms |

---

## Performance Best Practices

1. **Only update the DOM when necessary.** Call `Launcher.updateScore()` only when the score value actually changes, not on every frame.

2. **Draw static backgrounds once.** Render backgrounds, terrain, and other unchanging visuals in `create()`. Never redraw them in `update()`.

3. **Use Phaser's clock.** Use `this.time.now` instead of `Date.now()` for timestamps. This keeps your timing consistent with Phaser's internal simulation clock.

4. **Use binary search for sorted data.** When looking up values in sorted arrays (e.g., terrain height maps), use binary search for O(log n) performance instead of linear scan at O(n).

5. **Clean up arrays in `shutdown()`.** Reset all entity arrays to empty when the scene shuts down. This prevents stale references from persisting and leaking memory.

6. **Iterate in reverse when splicing.** Always loop from `length - 1` down to `0` when removing elements from arrays during iteration to avoid skipping elements.

7. **Use `setDepth()` for layer ordering.** Rely on explicit depth values rather than creation order for predictable z-ordering across all rendering paths.

8. **Limit particle count and lifetime.** Keep burst sizes small (4-8 particles) and lifetimes short (15-25 frames). Unconstrained particles are the easiest way to cause frame drops.

---

## Quick-Start Checklist

When creating a new game, make sure you:

- [ ] Create a new file in `js/games/` named after your game (e.g., `MyGame.js`)
- [ ] Extend `Phaser.Scene` with a unique `key` in the constructor
- [ ] Implement `create()`, `update()`, and `shutdown()`
- [ ] Register with `GameRegistry.register()` at the bottom of the file
- [ ] Use `this.scale.width` and `this.scale.height` for responsive sizing
- [ ] Use `CharacterFactory.createTexture()` for character sprites
- [ ] Call `Launcher.updateScore()` only when score changes
- [ ] Call `Launcher.saveGameScore()` on game end
- [ ] Add star thresholds in `SaveManager._starThresholds`
- [ ] Reset all arrays in `shutdown()` to prevent memory leaks
- [ ] Test that switching between games does not leak state
