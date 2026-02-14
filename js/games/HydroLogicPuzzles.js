/**
 * Game 13: Hydro-Logic Puzzles
 * ==============================
 * Classic: Aqua Energizer | Character: Logicron (Logic AI)
 * Mechanic: Sokoban-style push mechanics with gravity-based orbs.
 */

class HydroLogicPuzzles extends Phaser.Scene {
    constructor() {
        super({ key: 'HydroLogicPuzzles' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.moves = 0;
        this.tileSize = Math.min(width / 12, height / 10, 48);
        this.isAnimating = false;
        this.level = 0;

        // Levels: W=wall, .=floor, P=player, B=orb(box), T=target, *=orb on target
        this.levels = [
            [
                'WWWWWWWWWW',
                'W...W....W',
                'W.B....B.W',
                'W...WT...W',
                'WW.WWWW..W',
                'W...WT...W',
                'W.P..B...W',
                'W........W',
                'WWWWWWWWWW',
            ],
            [
                'WWWWWWWWWW',
                'W........W',
                'W..BWB...W',
                'W...P....W',
                'W..BWTW..W',
                'W...TT...W',
                'W........W',
                'WWWWWWWWWW',
            ]
        ];

        this._loadLevel(this.level);

        // Character badge
        const charKey = CharacterFactory.createTexture(this, 'logicron', 1.2);
        this.add.image(30, 20, charKey).setDepth(10);
        this.add.text(55, 12, 'Logicron - Hydro-Logic', {
            fontSize: '11px', color: '#2196F3', fontFamily: 'sans-serif'
        }).setDepth(10);

        // HUD
        this.moveText = this.add.text(width / 2, 10, 'Moves: 0', {
            fontSize: '13px', color: '#B0BEC5', fontFamily: 'sans-serif'
        }).setOrigin(0.5, 0).setDepth(10);

        this.add.text(width / 2, height - 12, 'Push orbs onto targets | Arrow keys / Swipe', {
            fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        // Graphics
        this.gridGraphics = this.add.graphics();

        // Input
        this.input.keyboard.on('keydown', this._onKey, this);
        this.input.on('pointerdown', (p) => { this.swipeStart = { x: p.x, y: p.y }; });
        this.input.on('pointerup', (p) => {
            if (!this.swipeStart) return;
            const dx = p.x - this.swipeStart.x;
            const dy = p.y - this.swipeStart.y;
            const min = 25;
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > min) {
                this._move(dx > 0 ? 1 : -1, 0);
            } else if (Math.abs(dy) > min) {
                this._move(0, dy > 0 ? 1 : -1);
            }
        });

        this._draw();
    }

    _loadLevel(idx) {
        const lvl = this.levels[idx % this.levels.length];
        this.grid = [];
        this.orbs = [];
        this.targets = [];
        this.playerPos = { r: 0, c: 0 };

        this.gridRows = lvl.length;
        this.gridCols = lvl[0].length;
        this.gridOffsetX = (this.scale.width - this.gridCols * this.tileSize) / 2;
        this.gridOffsetY = (this.scale.height - this.gridRows * this.tileSize) / 2 + 10;

        for (let r = 0; r < this.gridRows; r++) {
            this.grid[r] = [];
            for (let c = 0; c < this.gridCols; c++) {
                const ch = lvl[r][c];
                let tile = 'floor';
                if (ch === 'W') tile = 'wall';
                this.grid[r][c] = tile;

                if (ch === 'P') this.playerPos = { r, c };
                if (ch === 'B' || ch === '*') this.orbs.push({ r, c });
                if (ch === 'T' || ch === '*') this.targets.push({ r, c });
            }
        }
        this.moves = 0;
    }

    _onKey(event) {
        switch (event.code) {
            case 'ArrowUp': this._move(0, -1); break;
            case 'ArrowDown': this._move(0, 1); break;
            case 'ArrowLeft': this._move(-1, 0); break;
            case 'ArrowRight': this._move(1, 0); break;
            case 'KeyR': this._loadLevel(this.level); this._draw(); break;
        }
    }

    _move(dc, dr) {
        if (this.isAnimating) return;

        const nr = this.playerPos.r + dr;
        const nc = this.playerPos.c + dc;

        if (!this._isInBounds(nr, nc)) return;
        if (this.grid[nr][nc] === 'wall') return;

        // Check if there's an orb in the target cell
        const orbIdx = this.orbs.findIndex(o => o.r === nr && o.c === nc);

        if (orbIdx >= 0) {
            // Try to push the orb
            const orbNewR = nr + dr;
            const orbNewC = nc + dc;

            if (!this._isInBounds(orbNewR, orbNewC)) return;
            if (this.grid[orbNewR][orbNewC] === 'wall') return;
            if (this.orbs.some(o => o.r === orbNewR && o.c === orbNewC)) return;

            // Push orb
            this.orbs[orbIdx].r = orbNewR;
            this.orbs[orbIdx].c = orbNewC;

            // Apply gravity to the pushed orb (falls until hitting floor/wall/orb)
            this._applyGravity(orbIdx);
        }

        // Move player
        this.playerPos.r = nr;
        this.playerPos.c = nc;
        this.moves++;
        if (this.moveText) this.moveText.setText(`Moves: ${this.moves}`);

        this._draw();
        this._checkWin();
    }

    _applyGravity(orbIdx) {
        const orb = this.orbs[orbIdx];
        // Orbs fall down due to gravity
        while (true) {
            const below = orb.r + 1;
            if (!this._isInBounds(below, orb.c)) break;
            if (this.grid[below][orb.c] === 'wall') break;
            if (this.orbs.some((o, i) => i !== orbIdx && o.r === below && o.c === orb.c)) break;
            orb.r = below;
        }
    }

    _isInBounds(r, c) {
        return r >= 0 && r < this.gridRows && c >= 0 && c < this.gridCols;
    }

    _checkWin() {
        const allOnTarget = this.targets.every(t =>
            this.orbs.some(o => o.r === t.r && o.c === t.c)
        );
        if (allOnTarget && this.targets.length > 0) {
            this.score += Math.max(500 - this.moves * 5, 100);
            Launcher.updateScore(this.score);

            this.time.delayedCall(500, () => {
                this.level++;
                this._loadLevel(this.level);
                this._draw();
            });
        }
    }

    _draw() {
        const g = this.gridGraphics;
        g.clear();

        for (let r = 0; r < this.gridRows; r++) {
            for (let c = 0; c < this.gridCols; c++) {
                const x = this.gridOffsetX + c * this.tileSize;
                const y = this.gridOffsetY + r * this.tileSize;
                const s = this.tileSize - 2;

                if (this.grid[r][c] === 'wall') {
                    g.fillStyle(0x37474F, 1);
                    g.fillRect(x + 1, y + 1, s, s);
                } else {
                    g.fillStyle(0x1a1a2e, 1);
                    g.fillRect(x + 1, y + 1, s, s);
                }

                // Target marker
                if (this.targets.some(t => t.r === r && t.c === c)) {
                    g.lineStyle(2, 0x00BCD4, 0.8);
                    g.strokeCircle(x + this.tileSize / 2, y + this.tileSize / 2, s * 0.3);
                }
            }
        }

        // Draw orbs
        this.orbs.forEach(orb => {
            const x = this.gridOffsetX + orb.c * this.tileSize + this.tileSize / 2;
            const y = this.gridOffsetY + orb.r * this.tileSize + this.tileSize / 2;
            const r = (this.tileSize - 6) / 2;

            const isOnTarget = this.targets.some(t => t.r === orb.r && t.c === orb.c);
            g.fillStyle(isOnTarget ? 0x00BCD4 : 0x2196F3, 1);
            g.fillCircle(x, y, r);
            g.fillStyle(0xffffff, 0.3);
            g.fillCircle(x - r * 0.2, y - r * 0.2, r * 0.4);
        });

        // Draw player (Logicron - sphere)
        const px = this.gridOffsetX + this.playerPos.c * this.tileSize + this.tileSize / 2;
        const py = this.gridOffsetY + this.playerPos.r * this.tileSize + this.tileSize / 2;
        const pr = (this.tileSize - 8) / 2;

        g.fillStyle(0xB0BEC5, 1);
        g.fillCircle(px, py, pr);
        g.fillStyle(0x2196F3, 1);
        g.fillCircle(px - pr * 0.25, py - pr * 0.15, pr * 0.2);
        g.fillCircle(px + pr * 0.25, py - pr * 0.15, pr * 0.2);
    }

    update() {}
}

GameRegistry.register({
    id: 'HydroLogicPuzzles',
    title: 'Hydro-Logic Puzzles',
    classic: 'Aqua Energizer',
    character: 'logicron',
    mechanic: 'Sokoban-style push mechanics with gravity orbs',
    iconColor: '#006064',
    iconEmoji: '💧',
    scene: HydroLogicPuzzles
});
