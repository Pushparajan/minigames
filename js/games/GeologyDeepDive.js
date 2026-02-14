/**
 * Game 6: Geology Deep Dive
 * ===========================
 * Classic: Motherload | Character: Maya (Earth Science)
 * Mechanic: Procedural tile digging and fuel/resource management.
 */

class GeologyDeepDive extends Phaser.Scene {
    constructor() {
        super({ key: 'GeologyDeepDive' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.fuel = 100;
        this.cargo = 0;
        this.maxCargo = 10;
        this.tileSize = 28;
        this.cols = Math.floor(width / this.tileSize);
        this.rows = 40; // deep mine
        this.surfaceRow = 2;
        this.cameraOffsetY = 0;

        // Player grid position
        this.playerCol = Math.floor(this.cols / 2);
        this.playerRow = this.surfaceRow;

        // Generate mine grid
        this.grid = [];
        this._generateGrid();

        // Graphics
        this.gridGraphics = this.add.graphics();
        this.playerGraphics = this.add.graphics().setDepth(5);
        this.hudBg = this.add.graphics().setDepth(9);

        // Character
        const charKey = CharacterFactory.createTexture(this, 'maya', 1);
        this.charImg = this.add.image(0, 0, charKey).setDepth(6).setVisible(false);

        // HUD
        this.fuelText = this.add.text(10, 8, `Fuel: ${this.fuel}%`, {
            fontSize: '12px', color: '#FF8F00', fontFamily: 'sans-serif'
        }).setDepth(10).setScrollFactor(0);
        this.cargoText = this.add.text(10, 24, `Cargo: ${this.cargo}/${this.maxCargo}`, {
            fontSize: '12px', color: '#4CAF50', fontFamily: 'sans-serif'
        }).setDepth(10).setScrollFactor(0);
        this.depthText = this.add.text(width - 10, 8, 'Depth: 0m', {
            fontSize: '12px', color: '#90A4AE', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10).setScrollFactor(0);

        this.add.text(width / 2, height - 12, 'Arrow Keys / Swipe to dig | Return to surface to sell', {
            fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10).setScrollFactor(0);

        this._drawGrid();

        // Input
        this.input.keyboard.on('keydown', this._onKey, this);
        this.input.on('pointerdown', (p) => { this.swipeStart = { x: p.x, y: p.y }; });
        this.input.on('pointerup', (p) => {
            if (!this.swipeStart) return;
            const dx = p.x - this.swipeStart.x;
            const dy = p.y - this.swipeStart.y;
            const min = 20;
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > min) {
                this._move(dx > 0 ? 1 : -1, 0);
            } else if (Math.abs(dy) > min) {
                this._move(0, dy > 0 ? 1 : -1);
            }
        });
    }

    _generateGrid() {
        for (let r = 0; r < this.rows; r++) {
            this.grid[r] = [];
            for (let c = 0; c < this.cols; c++) {
                if (r < this.surfaceRow) {
                    this.grid[r][c] = { type: 'sky', dug: true };
                } else if (r === this.surfaceRow) {
                    this.grid[r][c] = { type: 'surface', dug: true };
                } else {
                    // Deeper = rarer minerals
                    const depth = r - this.surfaceRow;
                    let type = 'dirt';
                    const rand = Math.random();

                    if (rand < 0.03 && depth > 15) type = 'diamond';
                    else if (rand < 0.08 && depth > 10) type = 'gold';
                    else if (rand < 0.15 && depth > 5) type = 'silver';
                    else if (rand < 0.25) type = 'copper';
                    else if (rand < 0.05) type = 'rock'; // undiggable

                    this.grid[r][c] = { type, dug: false };
                }
            }
        }
    }

    _onKey(event) {
        switch (event.code) {
            case 'ArrowLeft': this._move(-1, 0); break;
            case 'ArrowRight': this._move(1, 0); break;
            case 'ArrowDown': this._move(0, 1); break;
            case 'ArrowUp': this._move(0, -1); break;
        }
    }

    _move(dc, dr) {
        if (this.fuel <= 0) return;

        const nc = this.playerCol + dc;
        const nr = this.playerRow + dr;

        if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) return;

        const tile = this.grid[nr][nc];
        if (tile.type === 'rock' && !tile.dug) return; // Can't dig rock

        // Dig the tile
        if (!tile.dug) {
            tile.dug = true;
            this.fuel -= 0.5;

            // Collect mineral
            const values = { copper: 10, silver: 25, gold: 50, diamond: 100 };
            if (values[tile.type] && this.cargo < this.maxCargo) {
                this.cargo++;
                this.cargoText.setText(`Cargo: ${this.cargo}/${this.maxCargo}`);
            }
        }

        this.fuel = Math.max(0, this.fuel - 0.3);
        this.fuelText.setText(`Fuel: ${Math.round(this.fuel)}%`);

        this.playerCol = nc;
        this.playerRow = nr;

        // Sell at surface
        if (nr <= this.surfaceRow && this.cargo > 0) {
            const depths = this.playerRow;
            this.score += this.cargo * 15;
            Launcher.updateScore(this.score);
            this.cargo = 0;
            this.fuel = Math.min(100, this.fuel + 20);
            this.cargoText.setText(`Cargo: 0/${this.maxCargo}`);
            this.fuelText.setText(`Fuel: ${Math.round(this.fuel)}%`);
        }

        this.depthText.setText(`Depth: ${Math.max(0, (nr - this.surfaceRow) * 3)}m`);

        // Fuel check
        if (this.fuel <= 0) {
            this.add.text(this.scale.width / 2, this.scale.height / 2, 'OUT OF FUEL!', {
                fontSize: '24px', color: '#FF5252',
                fontFamily: 'sans-serif', fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(20);
        }

        this._drawGrid();
    }

    _drawGrid() {
        const { width, height } = this.scale;
        const g = this.gridGraphics;
        g.clear();

        // Camera follow player vertically
        const visibleRows = Math.ceil(height / this.tileSize) + 2;
        const startRow = Math.max(0, this.playerRow - Math.floor(visibleRows / 2));
        const endRow = Math.min(this.rows, startRow + visibleRows);

        const colors = {
            sky: 0x87CEEB, surface: 0x6B8E23, dirt: 0x8B6914,
            copper: 0xB87333, silver: 0xC0C0C0, gold: 0xFFD700,
            diamond: 0x00BCD4, rock: 0x555555
        };

        for (let r = startRow; r < endRow; r++) {
            for (let c = 0; c < this.cols; c++) {
                const tile = this.grid[r][c];
                const x = c * this.tileSize;
                const y = (r - startRow) * this.tileSize;

                if (tile.dug) {
                    g.fillStyle(r < this.surfaceRow ? 0x87CEEB : 0x1a1a1a, 1);
                } else {
                    g.fillStyle(colors[tile.type] || 0x8B6914, 1);
                }
                g.fillRect(x, y, this.tileSize - 1, this.tileSize - 1);

                // Mineral sparkle
                if (!tile.dug && ['silver', 'gold', 'diamond'].includes(tile.type)) {
                    g.fillStyle(0xffffff, 0.4);
                    g.fillCircle(x + this.tileSize / 2, y + this.tileSize / 2, 3);
                }
            }
        }

        // Draw player
        const px = this.playerCol * this.tileSize + this.tileSize / 2;
        const py = (this.playerRow - startRow) * this.tileSize + this.tileSize / 2;

        this.playerGraphics.clear();
        this.playerGraphics.fillStyle(0x8D6E63, 1);
        this.playerGraphics.fillRoundedRect(px - 10, py - 12, 20, 24, 3);
        this.playerGraphics.fillStyle(0x4CAF50, 0.8);
        this.playerGraphics.fillRect(px - 8, py - 2, 16, 3);
        // Eyes
        this.playerGraphics.fillStyle(0xffffff, 1);
        this.playerGraphics.fillCircle(px - 3, py - 6, 2.5);
        this.playerGraphics.fillCircle(px + 3, py - 6, 2.5);
        this.playerGraphics.fillStyle(0x111111, 1);
        this.playerGraphics.fillCircle(px - 3, py - 6, 1);
        this.playerGraphics.fillCircle(px + 3, py - 6, 1);
    }

    update() {
        // Event-driven game
    }
}

GameRegistry.register({
    id: 'GeologyDeepDive',
    title: 'Geology Deep Dive',
    classic: 'Motherload',
    character: 'maya',
    mechanic: 'Procedural tile digging and fuel/resource management',
    iconColor: '#5D4037',
    iconEmoji: '⛏',
    scene: GeologyDeepDive
});
