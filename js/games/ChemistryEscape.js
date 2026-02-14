/**
 * Game 11: Chemistry Escape
 * ===========================
 * Classic: Acid Factory | Character: Andrés (Chemistry)
 * Mechanic: Platformer logic with "Hazard Tiles" and chemical key-locks.
 */

class ChemistryEscape extends Phaser.Scene {
    constructor() {
        super({ key: 'ChemistryEscape' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.tileSize = 32;
        this.playerVX = 0;
        this.playerVY = 0;
        this.isGrounded = false;
        this.keysCollected = { red: false, blue: false, green: false };
        this.gameWon = false;

        // Level map
        // 0=empty, 1=floor, 2=acid(hazard), 3=red-key, 4=blue-key, 5=green-key
        // 6=red-lock, 7=blue-lock, 8=green-lock, 9=exit
        this.levelMap = [
            [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
            [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 9, 1],
            [1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 8, 1, 1, 1],
            [1, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            [1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 7, 1, 0, 0, 1],
            [1, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 6, 0, 1],
            [1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
            [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            [1, 2, 2, 1, 1, 2, 2, 2, 1, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 1],
            [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        ];

        this.rows = this.levelMap.length;
        this.cols = this.levelMap[0].length;
        this.gridOffsetX = (width - this.cols * this.tileSize) / 2;
        this.gridOffsetY = (height - this.rows * this.tileSize) / 2;

        // Player start
        this.playerCol = 1.5;
        this.playerRow = 10.5;
        this.playerW = 14;
        this.playerH = 24;

        // Graphics
        this.mapGraphics = this.add.graphics();
        this.playerGraphics = this.add.graphics().setDepth(5);
        this._drawMap();

        // Character
        const charKey = CharacterFactory.createTexture(this, 'andres', 1);
        this.add.image(30, 15, charKey).setDepth(10);
        this.add.text(55, 8, 'Andrés - Chemistry Escape', {
            fontSize: '11px', color: '#FF9800', fontFamily: 'sans-serif'
        }).setDepth(10);

        // Key display
        this.keyText = this.add.text(width - 10, 10, 'Keys: ---', {
            fontSize: '12px', color: '#ffffff', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);

        this.add.text(width / 2, height - 10,
            'Arrow keys / WASD / Touch to move | Collect keys to unlock doors', {
                fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
            }).setOrigin(0.5).setDepth(10);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({ w: 'W', a: 'A', d: 'D' });

        // Touch controls
        this.input.on('pointerdown', (p) => { this.touchStart = { x: p.x, y: p.y }; });
        this.input.on('pointermove', (p) => {
            if (!this.touchStart) return;
            const dx = p.x - this.touchStart.x;
            if (Math.abs(dx) > 10) {
                this.touchDir = dx > 0 ? 1 : -1;
            }
        });
        this.input.on('pointerup', (p) => {
            if (this.touchStart && this.touchStart.y - p.y > 30) {
                this._jump();
            }
            this.touchDir = 0;
            this.touchStart = null;
        });
        this.touchDir = 0;
    }

    _drawMap() {
        const g = this.mapGraphics;
        g.clear();

        const colors = {
            1: 0x546E7A,  // Floor
            2: 0x76FF03,  // Acid
            3: 0xE53935,  // Red key
            4: 0x2196F3,  // Blue key
            5: 0x4CAF50,  // Green key
            6: 0xE53935,  // Red lock
            7: 0x2196F3,  // Blue lock
            8: 0x4CAF50,  // Green lock
            9: 0xFFD700   // Exit
        };

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const tile = this.levelMap[r][c];
                if (tile === 0) continue;

                const x = this.gridOffsetX + c * this.tileSize;
                const y = this.gridOffsetY + r * this.tileSize;
                const s = this.tileSize;

                g.fillStyle(colors[tile] || 0x555555, 1);
                g.fillRect(x, y, s - 1, s - 1);

                // Special markers
                if (tile >= 3 && tile <= 5) {
                    // Keys: diamond shape
                    g.fillStyle(0xffffff, 0.6);
                    const cx = x + s / 2;
                    const cy = y + s / 2;
                    g.beginPath();
                    g.moveTo(cx, cy - 6);
                    g.lineTo(cx + 6, cy);
                    g.lineTo(cx, cy + 6);
                    g.lineTo(cx - 6, cy);
                    g.closePath();
                    g.fillPath();
                }
                if (tile >= 6 && tile <= 8) {
                    // Locks: X pattern
                    g.lineStyle(2, 0xffffff, 0.6);
                    g.beginPath();
                    g.moveTo(x + 4, y + 4);
                    g.lineTo(x + s - 4, y + s - 4);
                    g.moveTo(x + s - 4, y + 4);
                    g.lineTo(x + 4, y + s - 4);
                    g.strokePath();
                }
                if (tile === 9) {
                    g.fillStyle(0xffffff, 0.4);
                    g.fillCircle(x + s / 2, y + s / 2, 8);
                }
                if (tile === 2) {
                    // Acid bubbles
                    g.fillStyle(0xB2FF59, 0.5);
                    g.fillCircle(x + s * 0.3, y + s * 0.4, 3);
                    g.fillCircle(x + s * 0.7, y + s * 0.6, 2);
                }
            }
        }
    }

    _jump() {
        if (this.isGrounded) {
            this.playerVY = -8;
            this.isGrounded = false;
        }
    }

    _getTile(row, col) {
        if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return 1;
        return this.levelMap[Math.floor(row)][Math.floor(col)];
    }

    _isSolid(tile) {
        return tile === 1 || (tile >= 6 && tile <= 8);
    }

    update() {
        if (this.gameWon) return;

        // Movement input
        let moveX = 0;
        if (this.cursors.left.isDown || this.wasd.a.isDown || this.touchDir < 0) moveX = -3;
        if (this.cursors.right.isDown || this.wasd.d.isDown || this.touchDir > 0) moveX = 3;
        if ((this.cursors.up.isDown || this.wasd.w.isDown) && this.isGrounded) this._jump();

        // Apply horizontal
        this.playerCol += moveX / this.tileSize;

        // Horizontal collision
        const pLeft = this.playerCol - this.playerW / this.tileSize / 2;
        const pRight = this.playerCol + this.playerW / this.tileSize / 2;
        const pTop = this.playerRow - this.playerH / this.tileSize / 2;
        const pBottom = this.playerRow + this.playerH / this.tileSize / 2;

        if (moveX < 0 && this._isSolid(this._getTile(this.playerRow, pLeft))) {
            this.playerCol = Math.floor(pLeft) + 1 + this.playerW / this.tileSize / 2;
        }
        if (moveX > 0 && this._isSolid(this._getTile(this.playerRow, pRight))) {
            this.playerCol = Math.floor(pRight) - this.playerW / this.tileSize / 2;
        }

        // Gravity
        this.playerVY += 0.4;
        this.playerRow += this.playerVY / this.tileSize;

        // Vertical collision
        const newBottom = this.playerRow + this.playerH / this.tileSize / 2;
        const newTop = this.playerRow - this.playerH / this.tileSize / 2;

        if (this.playerVY > 0 && this._isSolid(this._getTile(newBottom, this.playerCol))) {
            this.playerRow = Math.floor(newBottom) - this.playerH / this.tileSize / 2;
            this.playerVY = 0;
            this.isGrounded = true;
        } else {
            this.isGrounded = false;
        }

        if (this.playerVY < 0 && this._isSolid(this._getTile(newTop, this.playerCol))) {
            this.playerRow = Math.floor(newTop) + 1 + this.playerH / this.tileSize / 2;
            this.playerVY = 0;
        }

        // Tile interactions
        const currentTile = this._getTile(this.playerRow, this.playerCol);

        // Acid damage
        if (currentTile === 2) {
            this.playerCol = 1.5;
            this.playerRow = 10.5;
            this.playerVY = 0;
        }

        // Collect keys
        const cr = Math.floor(this.playerRow);
        const cc = Math.floor(this.playerCol);
        if (cr >= 0 && cr < this.rows && cc >= 0 && cc < this.cols) {
            const t = this.levelMap[cr][cc];
            if (t === 3) { this.keysCollected.red = true; this.levelMap[cr][cc] = 0; }
            if (t === 4) { this.keysCollected.blue = true; this.levelMap[cr][cc] = 0; }
            if (t === 5) { this.keysCollected.green = true; this.levelMap[cr][cc] = 0; }
            // Unlock doors
            if (t === 6 && this.keysCollected.red) { this.levelMap[cr][cc] = 0; }
            if (t === 7 && this.keysCollected.blue) { this.levelMap[cr][cc] = 0; }
            if (t === 8 && this.keysCollected.green) { this.levelMap[cr][cc] = 0; }
            // Exit
            if (t === 9 && this.keysCollected.red && this.keysCollected.blue && this.keysCollected.green) {
                this.gameWon = true;
                this.score += 1000;
                Launcher.updateScore(this.score);
                this.add.text(this.scale.width / 2, this.scale.height / 2, 'ESCAPED!', {
                    fontSize: '32px', color: '#FFD700',
                    fontFamily: 'sans-serif', fontStyle: 'bold'
                }).setOrigin(0.5).setDepth(20);
            }
        }

        // Update key display
        const k = this.keysCollected;
        this.keyText.setText(`Keys: ${k.red ? 'R' : '-'}${k.blue ? 'B' : '-'}${k.green ? 'G' : '-'}`);

        // Redraw
        this._drawMap();

        // Draw player
        this.playerGraphics.clear();
        const px = this.gridOffsetX + this.playerCol * this.tileSize;
        const py = this.gridOffsetY + this.playerRow * this.tileSize;
        this.playerGraphics.fillStyle(0xFFFFFF, 1); // Lab coat
        this.playerGraphics.fillRoundedRect(px - 7, py - 12, 14, 24, 2);
        this.playerGraphics.fillStyle(0xFF9800, 1); // Apron
        this.playerGraphics.fillRect(px - 5, py, 10, 3);
        this.playerGraphics.fillStyle(0x111111, 1);
        this.playerGraphics.fillCircle(px - 2, py - 7, 1.5);
        this.playerGraphics.fillCircle(px + 2, py - 7, 1.5);
    }
}

GameRegistry.register({
    id: 'ChemistryEscape',
    title: 'Chemistry Escape',
    classic: 'Acid Factory',
    character: 'andres',
    mechanic: 'Platformer with hazard tiles and chemical key-locks',
    iconColor: '#E65100',
    iconEmoji: '🧪',
    scene: ChemistryEscape
});
