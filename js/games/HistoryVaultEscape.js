/**
 * Game 19: History Vault Escape
 * ================================
 * Classic: Pharaoh's Tomb | Character: Grandpa Vidur (History of Science)
 * Mechanic: Grid-based puzzle adventure with trap-trigger logic.
 */

class HistoryVaultEscape extends Phaser.Scene {
    constructor() {
        super({ key: 'HistoryVaultEscape' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.moves = 0;
        this.tileSize = Math.min(width / 14, height / 12, 44);
        this.keysFound = 0;

        // Level: W=wall, .=floor, P=player, K=key, D=door, T=trap(spikes),
        //        S=switch(disarms trap), G=goal(exit), B=pushblock
        this.levelData = [
            'WWWWWWWWWWWW',
            'WP.....W..GW',
            'W.WWW..W..DW',
            'W...W..W...W',
            'W.B.W.KW.T.W',
            'W...W..WS..W',
            'W.T.WWWW...W',
            'WS..........W',
            'W..BWW.K.T.W',
            'W....W...S.W',
            'W....W.....W',
            'WWWWWWWWWWWW',
        ];

        this.rows = this.levelData.length;
        this.cols = this.levelData[0].length;
        this.gridOffsetX = (width - this.cols * this.tileSize) / 2;
        this.gridOffsetY = (height - this.rows * this.tileSize) / 2 + 15;

        // Parse level
        this.grid = [];
        this.traps = [];
        this.switches = [];
        this.keys = [];
        this.doors = [];
        this.blocks = [];
        this.playerPos = { r: 1, c: 1 };
        this.goalPos = null;

        for (let r = 0; r < this.rows; r++) {
            this.grid[r] = [];
            for (let c = 0; c < this.cols; c++) {
                const ch = this.levelData[r][c];
                this.grid[r][c] = ch === 'W' ? 'wall' : 'floor';

                switch (ch) {
                    case 'P': this.playerPos = { r, c }; break;
                    case 'K': this.keys.push({ r, c, collected: false }); break;
                    case 'D': this.doors.push({ r, c, locked: true }); this.grid[r][c] = 'wall'; break;
                    case 'T': this.traps.push({ r, c, active: true }); break;
                    case 'S': this.switches.push({ r, c, pressed: false }); break;
                    case 'G': this.goalPos = { r, c }; break;
                    case 'B': this.blocks.push({ r, c }); break;
                }
            }
        }

        // Graphics
        this.mapGraphics = this.add.graphics();
        this.spriteGraphics = this.add.graphics().setDepth(5);

        // Character
        const charKey = CharacterFactory.createTexture(this, 'grandpaVidur', 1);
        this.add.image(25, 15, charKey).setDepth(10);
        this.add.text(50, 8, 'Grandpa Vidur - History Vault', {
            fontSize: '10px', color: '#D7CCC8', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.moveText = this.add.text(width / 2, 10, 'Moves: 0', {
            fontSize: '12px', color: '#90A4AE', fontFamily: 'sans-serif'
        }).setOrigin(0.5, 0).setDepth(10);
        this.keyText = this.add.text(width - 10, 10, `Keys: ${this.keysFound}`, {
            fontSize: '12px', color: '#FFD700', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);

        this.add.text(width / 2, height - 10,
            'Arrow keys / Swipe | Collect keys, hit switches, avoid traps', {
                fontSize: '9px', color: '#555577', fontFamily: 'sans-serif'
            }).setOrigin(0.5).setDepth(10);

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

        this._draw();
    }

    _onKey(event) {
        switch (event.code) {
            case 'ArrowUp': this._move(0, -1); break;
            case 'ArrowDown': this._move(0, 1); break;
            case 'ArrowLeft': this._move(-1, 0); break;
            case 'ArrowRight': this._move(1, 0); break;
        }
    }

    _move(dc, dr) {
        const nr = this.playerPos.r + dr;
        const nc = this.playerPos.c + dc;

        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) return;
        if (this.grid[nr][nc] === 'wall') return;

        // Check pushable blocks
        const blockIdx = this.blocks.findIndex(b => b.r === nr && b.c === nc);
        if (blockIdx >= 0) {
            const bnr = nr + dr;
            const bnc = nc + dc;
            if (bnr < 0 || bnr >= this.rows || bnc < 0 || bnc >= this.cols) return;
            if (this.grid[bnr][bnc] === 'wall') return;
            if (this.blocks.some(b => b.r === bnr && b.c === bnc)) return;
            this.blocks[blockIdx].r = bnr;
            this.blocks[blockIdx].c = bnc;
        }

        this.playerPos.r = nr;
        this.playerPos.c = nc;
        this.moves++;
        this.moveText.setText(`Moves: ${this.moves}`);

        // Collect keys
        this.keys.forEach(k => {
            if (!k.collected && k.r === nr && k.c === nc) {
                k.collected = true;
                this.keysFound++;
                this.keyText.setText(`Keys: ${this.keysFound}`);
                this.score += 100;
                Launcher.updateScore(this.score);
                // Unlock doors
                this.doors.forEach(d => {
                    if (d.locked) {
                        d.locked = false;
                        this.grid[d.r][d.c] = 'floor';
                    }
                });
            }
        });

        // Hit switches
        this.switches.forEach(s => {
            if (!s.pressed && s.r === nr && s.c === nc) {
                s.pressed = true;
                // Disarm closest active trap
                const activeTrap = this.traps.find(t => t.active);
                if (activeTrap) activeTrap.active = false;
            }
        });

        // Trap damage
        const activeTrap = this.traps.find(t => t.active && t.r === nr && t.c === nc);
        if (activeTrap) {
            // Reset player
            this.playerPos = { r: 1, c: 1 };
        }

        // Goal
        if (this.goalPos && nr === this.goalPos.r && nc === this.goalPos.c) {
            this.score += 500;
            Launcher.updateScore(this.score);
            this.add.text(this.scale.width / 2, this.scale.height / 2,
                `VAULT ESCAPED!\nMoves: ${this.moves}`, {
                    fontSize: '24px', color: '#FFD700', align: 'center',
                    fontFamily: 'sans-serif', fontStyle: 'bold'
                }).setOrigin(0.5).setDepth(20);
        }

        this._draw();
    }

    _draw() {
        const g = this.mapGraphics;
        g.clear();
        const ts = this.tileSize;

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const x = this.gridOffsetX + c * ts;
                const y = this.gridOffsetY + r * ts;

                if (this.grid[r][c] === 'wall') {
                    g.fillStyle(0x5D4037, 1);
                    g.fillRect(x, y, ts - 1, ts - 1);
                    g.lineStyle(1, 0x3E2723, 0.5);
                    g.strokeRect(x, y, ts - 1, ts - 1);
                } else {
                    g.fillStyle(0x2a2a2e, 1);
                    g.fillRect(x, y, ts - 1, ts - 1);
                }
            }
        }

        // Keys
        this.keys.forEach(k => {
            if (k.collected) return;
            const x = this.gridOffsetX + k.c * ts + ts / 2;
            const y = this.gridOffsetY + k.r * ts + ts / 2;
            g.fillStyle(0xFFD700, 1);
            g.beginPath();
            g.moveTo(x, y - 6);
            g.lineTo(x + 5, y);
            g.lineTo(x, y + 6);
            g.lineTo(x - 5, y);
            g.closePath();
            g.fillPath();
        });

        // Traps
        this.traps.forEach(t => {
            const x = this.gridOffsetX + t.c * ts;
            const y = this.gridOffsetY + t.r * ts;
            g.fillStyle(t.active ? 0xE53935 : 0x555555, t.active ? 0.7 : 0.3);
            // Spike pattern
            for (let s = 0; s < 3; s++) {
                g.beginPath();
                g.moveTo(x + s * ts / 3 + 2, y + ts - 2);
                g.lineTo(x + s * ts / 3 + ts / 6 + 2, y + 4);
                g.lineTo(x + (s + 1) * ts / 3, y + ts - 2);
                g.fillPath();
            }
        });

        // Switches
        this.switches.forEach(s => {
            const x = this.gridOffsetX + s.c * ts + ts / 2;
            const y = this.gridOffsetY + s.r * ts + ts / 2;
            g.fillStyle(s.pressed ? 0x555555 : 0x4CAF50, 1);
            g.fillRoundedRect(x - 6, y - 4, 12, 8, 2);
        });

        // Blocks
        this.blocks.forEach(b => {
            const x = this.gridOffsetX + b.c * ts + 3;
            const y = this.gridOffsetY + b.r * ts + 3;
            g.fillStyle(0x795548, 1);
            g.fillRect(x, y, ts - 6, ts - 6);
            g.lineStyle(1, 0x5D4037, 0.8);
            g.strokeRect(x, y, ts - 6, ts - 6);
        });

        // Goal
        if (this.goalPos) {
            const gx = this.gridOffsetX + this.goalPos.c * ts + ts / 2;
            const gy = this.gridOffsetY + this.goalPos.r * ts + ts / 2;
            g.fillStyle(0xFFD700, 0.6 + Math.sin(Date.now() / 300) * 0.3);
            g.fillCircle(gx, gy, 8);
        }

        // Player
        this.spriteGraphics.clear();
        const px = this.gridOffsetX + this.playerPos.c * ts + ts / 2;
        const py = this.gridOffsetY + this.playerPos.r * ts + ts / 2;
        this.spriteGraphics.fillStyle(0xD7CCC8, 1);
        this.spriteGraphics.fillRoundedRect(px - 8, py - 12, 16, 24, 3);
        this.spriteGraphics.fillStyle(0xFFE0B2, 1);
        this.spriteGraphics.fillCircle(px, py - 8, 5);
        this.spriteGraphics.fillStyle(0x9E9E9E, 1); // Glasses
        this.spriteGraphics.strokeCircle(px - 2, py - 9, 2);
        this.spriteGraphics.strokeCircle(px + 2, py - 9, 2);
    }

    update() {}

    shutdown() {
        this.grid = [];
        this.traps = [];
        this.switches = [];
        this.keys = [];
        this.doors = [];
        this.blocks = [];
    }
}

GameRegistry.register({
    id: 'HistoryVaultEscape',
    title: 'History Vault Escape',
    classic: "Pharaoh's Tomb",
    character: 'grandpaVidur',
    mechanic: 'Grid-based puzzle with traps and switches',
    iconColor: '#4E342E',
    iconEmoji: '🏛',
    scene: HistoryVaultEscape
});
