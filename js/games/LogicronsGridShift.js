/**
 * Game 3: Logicron's Grid Shift
 * ================================
 * Classic: Bloxorz | Character: Logicron (Logic AI)
 * Mechanic: 3D-to-2D top-down grid movement with edge-fall detection.
 *
 * A rectangular block (2x1x1) must be maneuvered on a grid to
 * stand upright over the goal hole. The block can roll in 4 directions.
 * If any part goes off the grid, it falls.
 */

class LogicronsGridShift extends Phaser.Scene {
    constructor() {
        super({ key: 'LogicronsGridShift' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.moves = 0;
        this.tileSize = Math.min(width / 14, height / 10, 50);
        this.isAnimating = false;

        // Level map: 1=floor, 2=goal, 0=void
        this.levelData = [
            [0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
            [0, 0, 0, 1, 1, 1, 1, 1, 0, 0],
            [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
            [1, 1, 1, 1, 0, 0, 1, 1, 1, 1],
            [1, 1, 1, 0, 0, 0, 0, 1, 1, 1],
            [0, 1, 1, 1, 1, 1, 1, 1, 2, 0],
            [0, 0, 0, 1, 1, 1, 1, 1, 0, 0],
        ];

        this.gridRows = this.levelData.length;
        this.gridCols = this.levelData[0].length;

        // Center the grid
        this.gridOffsetX = (width - this.gridCols * this.tileSize) / 2;
        this.gridOffsetY = (height - this.gridRows * this.tileSize) / 2 + 20;

        // Block state: standing=upright on one tile, lyingH=horizontal, lyingV=vertical
        // Position is the "anchor" tile (top-left of occupied tiles)
        this.block = { row: 2, col: 1, state: 'standing' };

        // Draw everything
        this.gridGraphics = this.add.graphics();
        this.blockGraphics = this.add.graphics();
        this._drawGrid();
        this._drawBlock();

        // Character badge
        const charKey = CharacterFactory.createTexture(this, 'logicron', 1.5);
        this.add.image(50, 25, charKey).setDepth(10);
        this.add.text(80, 15, "Logicron's Grid Shift", {
            fontSize: '13px', color: '#2196F3', fontFamily: 'sans-serif'
        }).setDepth(10);

        // Move counter
        this.moveText = this.add.text(width / 2, 20, 'Moves: 0', {
            fontSize: '14px', color: '#B0BEC5', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        // Instructions
        this.add.text(width / 2, height - 20,
            'Arrow keys / Swipe to roll the block onto the goal', {
                fontSize: '12px', color: '#7777aa', fontFamily: 'sans-serif'
            }).setOrigin(0.5);

        // Keyboard input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.input.keyboard.on('keydown', this._onKeyDown, this);

        // Touch/swipe input
        this.input.on('pointerdown', (p) => { this.swipeStart = { x: p.x, y: p.y }; });
        this.input.on('pointerup', (p) => {
            if (!this.swipeStart) return;
            const dx = p.x - this.swipeStart.x;
            const dy = p.y - this.swipeStart.y;
            const minSwipe = 30;
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > minSwipe) {
                this._moveBlock(dx > 0 ? 'right' : 'left');
            } else if (Math.abs(dy) > minSwipe) {
                this._moveBlock(dy > 0 ? 'down' : 'up');
            }
        });
    }

    _onKeyDown(event) {
        switch (event.code) {
            case 'ArrowUp': this._moveBlock('up'); break;
            case 'ArrowDown': this._moveBlock('down'); break;
            case 'ArrowLeft': this._moveBlock('left'); break;
            case 'ArrowRight': this._moveBlock('right'); break;
        }
    }

    /**
     * Core mechanic: Roll the block in a direction.
     * The block's state changes depending on its current orientation.
     */
    _moveBlock(dir) {
        if (this.isAnimating) return;

        const b = this.block;
        let newRow = b.row;
        let newCol = b.col;
        let newState = b.state;

        if (b.state === 'standing') {
            switch (dir) {
                case 'up':    newRow -= 2; newState = 'lyingV'; break;
                case 'down':  newRow += 1; newState = 'lyingV'; break;
                case 'left':  newCol -= 2; newState = 'lyingH'; break;
                case 'right': newCol += 1; newState = 'lyingH'; break;
            }
        } else if (b.state === 'lyingH') { // Occupies (row, col) and (row, col+1)
            switch (dir) {
                case 'up':    newRow -= 1; break;
                case 'down':  newRow += 1; break;
                case 'left':  newCol -= 1; newState = 'standing'; break;
                case 'right': newCol += 2; newState = 'standing'; break;
            }
        } else if (b.state === 'lyingV') { // Occupies (row, col) and (row+1, col)
            switch (dir) {
                case 'up':    newRow -= 1; newState = 'standing'; break;
                case 'down':  newRow += 2; newState = 'standing'; break;
                case 'left':  newCol -= 1; break;
                case 'right': newCol += 1; break;
            }
        }

        // Get occupied tiles for the new position
        const occupied = this._getOccupied(newRow, newCol, newState);

        // Check if all occupied tiles are valid floor
        const allValid = occupied.every(([r, c]) =>
            r >= 0 && r < this.gridRows && c >= 0 && c < this.gridCols &&
            this.levelData[r][c] > 0
        );

        if (!allValid) {
            // Fall off edge
            this._fallOff();
            return;
        }

        // Apply move
        b.row = newRow;
        b.col = newCol;
        b.state = newState;
        this.moves++;
        this.moveText.setText(`Moves: ${this.moves}`);
        this._drawBlock();

        // Check win: standing on the goal tile
        if (b.state === 'standing' && this.levelData[b.row][b.col] === 2) {
            this._winLevel();
        }
    }

    _getOccupied(row, col, state) {
        if (state === 'standing') return [[row, col]];
        if (state === 'lyingH') return [[row, col], [row, col + 1]];
        if (state === 'lyingV') return [[row, col], [row + 1, col]];
        return [[row, col]];
    }

    _drawGrid() {
        const g = this.gridGraphics;
        g.clear();

        for (let r = 0; r < this.gridRows; r++) {
            for (let c = 0; c < this.gridCols; c++) {
                const tile = this.levelData[r][c];
                if (tile === 0) continue;

                const x = this.gridOffsetX + c * this.tileSize;
                const y = this.gridOffsetY + r * this.tileSize;
                const s = this.tileSize - 2;

                if (tile === 2) {
                    // Goal
                    g.fillStyle(0xFFD700, 0.8);
                    g.fillRect(x + 1, y + 1, s, s);
                    g.fillStyle(0x111111, 1);
                    g.fillCircle(x + this.tileSize / 2, y + this.tileSize / 2, s * 0.2);
                } else {
                    // Floor
                    g.fillStyle(0x3a3a5c, 1);
                    g.fillRect(x + 1, y + 1, s, s);
                    g.lineStyle(1, 0x50507a, 0.5);
                    g.strokeRect(x + 1, y + 1, s, s);
                }
            }
        }
    }

    _drawBlock() {
        const g = this.blockGraphics;
        g.clear();

        const b = this.block;
        const occupied = this._getOccupied(b.row, b.col, b.state);

        occupied.forEach(([r, c]) => {
            const x = this.gridOffsetX + c * this.tileSize + 3;
            const y = this.gridOffsetY + r * this.tileSize + 3;
            const s = this.tileSize - 6;

            // Block color: brighter when standing (taller)
            if (b.state === 'standing') {
                g.fillStyle(0x2196F3, 1);
            } else {
                g.fillStyle(0x1565C0, 1);
            }
            g.fillRoundedRect(x, y, s, s, 3);

            // Inner glow
            g.fillStyle(0x64B5F6, 0.3);
            g.fillRoundedRect(x + 3, y + 3, s - 6, s - 6, 2);
        });
    }

    _fallOff() {
        this.isAnimating = true;
        const { width, height } = this.scale;

        this.add.text(width / 2, height / 2, 'FELL OFF!', {
            fontSize: '24px', color: '#E53935', fontFamily: 'sans-serif', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(20).setAlpha(0);

        // Reset after delay
        this.tweens.add({
            targets: this.blockGraphics,
            alpha: 0,
            duration: 400,
            onComplete: () => {
                this.block = { row: 2, col: 1, state: 'standing' };
                this.blockGraphics.setAlpha(1);
                this._drawBlock();
                this.isAnimating = false;
            }
        });
    }

    _winLevel() {
        this.score += Math.max(500 - this.moves * 10, 100);
        Launcher.updateScore(this.score);

        this.add.text(this.scale.width / 2, this.scale.height / 2,
            `LEVEL COMPLETE!\nMoves: ${this.moves}`, {
                fontSize: '24px', color: '#FFD700', align: 'center',
                fontFamily: 'sans-serif', fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(20);
    }

    update() {
        // Static game — all logic is event-driven
    }

    shutdown() {
        this.levelData = [];
    }
}

GameRegistry.register({
    id: 'LogicronsGridShift',
    title: "Logicron's Grid Shift",
    classic: 'Bloxorz',
    character: 'logicron',
    mechanic: '3D-to-2D grid movement with edge-fall detection',
    iconColor: '#1565C0',
    iconEmoji: '🧊',
    scene: LogicronsGridShift
});
