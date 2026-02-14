/**
 * Game 16: Find the Principal
 * ==============================
 * Classic: Save the Sheriff | Character: Guha (Physics)
 * Mechanic: Classic platforming with "Enemy Stomp" and ladder logic.
 */

class FindThePrincipal extends Phaser.Scene {
    constructor() {
        super({ key: 'FindThePrincipal' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.lives = 3;
        this.playerVX = 0;
        this.playerVY = 0;
        this.isGrounded = false;
        this.onLadder = false;
        this.gameWon = false;

        // Level layout
        this.tileSize = 32;
        // 1=floor, L=ladder, E=enemy-spawn, P=principal(goal), S=start
        this.levelMap = [
            '11111111111111111111111111',
            '1S.........1............1',
            '1..........1............1',
            '1......E...1....E.......1',
            '111111111..111111111..111',
            '1........L.........L....1',
            '1........L.........L....1',
            '1....E...L.....E...L....1',
            '11111111111..111111111111',
            '1........L...........L..1',
            '1........L...........L..1',
            '1....E...L.......E...L..1',
            '111111111111..1111111111P',
            '1111111111111111111111111',
        ];

        this.rows = this.levelMap.length;
        this.cols = this.levelMap[0].length;
        this.gridOffsetX = (width - this.cols * this.tileSize) / 2;
        this.gridOffsetY = (height - this.rows * this.tileSize) / 2;

        // Parse level
        this.enemies = [];
        this.ladders = [];
        this.floors = [];
        this.principalPos = null;

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const ch = this.levelMap[r][c];
                if (ch === '1') this.floors.push({ r, c });
                if (ch === 'L') this.ladders.push({ r, c });
                if (ch === 'S') {
                    this.playerR = r;
                    this.playerC = c + 0.5;
                }
                if (ch === 'P') this.principalPos = { r: r - 1, c };
                if (ch === 'E') {
                    this.enemies.push({
                        r, c: c + 0.5, dir: 1, speed: 0.02, active: true,
                        startC: c - 1, endC: c + 3
                    });
                }
            }
        }

        // Graphics
        this.mapGraphics = this.add.graphics();
        this.spriteGraphics = this.add.graphics().setDepth(5);

        // HUD
        const charKey = CharacterFactory.createTexture(this, 'guha', 1);
        this.add.image(25, 15, charKey).setDepth(10);
        this.add.text(50, 8, 'Guha - Find the Principal', {
            fontSize: '11px', color: '#E53935', fontFamily: 'sans-serif'
        }).setDepth(10);
        this.livesText = this.add.text(width - 10, 10, `Lives: ${this.lives}`, {
            fontSize: '13px', color: '#E53935', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);

        this.add.text(width / 2, height - 10, 'Arrows/WASD | Stomp enemies from above!', {
            fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({ w: 'W', a: 'A', s: 'S', d: 'D' });

        this._drawMap();
    }

    _isSolid(r, c) {
        if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return true;
        return this.levelMap[r][c] === '1';
    }

    _isLadder(r, c) {
        return this.ladders.some(l => l.r === r && l.c === c);
    }

    _drawMap() {
        const g = this.mapGraphics;
        g.clear();

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const x = this.gridOffsetX + c * this.tileSize;
                const y = this.gridOffsetY + r * this.tileSize;
                const ch = this.levelMap[r][c];

                if (ch === '1') {
                    g.fillStyle(0x546E7A, 1);
                    g.fillRect(x, y, this.tileSize - 1, this.tileSize - 1);
                    g.lineStyle(1, 0x37474F, 0.5);
                    g.strokeRect(x, y, this.tileSize - 1, this.tileSize - 1);
                }
            }
        }

        // Ladders
        this.ladders.forEach(l => {
            const x = this.gridOffsetX + l.c * this.tileSize;
            const y = this.gridOffsetY + l.r * this.tileSize;
            g.fillStyle(0x8D6E63, 0.7);
            g.fillRect(x + 4, y, 4, this.tileSize);
            g.fillRect(x + this.tileSize - 8, y, 4, this.tileSize);
            // Rungs
            for (let ry = 4; ry < this.tileSize; ry += 8) {
                g.fillRect(x + 4, y + ry, this.tileSize - 8, 2);
            }
        });

        // Principal (goal)
        if (this.principalPos) {
            const px = this.gridOffsetX + this.principalPos.c * this.tileSize + this.tileSize / 2;
            const py = this.gridOffsetY + this.principalPos.r * this.tileSize + this.tileSize / 2;
            g.fillStyle(0xFFD700, 0.8);
            g.fillCircle(px, py, 10);
            g.fillStyle(0xffffff, 0.5);
            g.fillCircle(px - 2, py - 2, 4);
        }
    }

    update() {
        if (this.gameWon) return;

        const ts = this.tileSize;
        let moveX = 0;
        let moveY = 0;

        if (this.cursors.left.isDown || this.wasd.a.isDown) moveX = -0.08;
        if (this.cursors.right.isDown || this.wasd.d.isDown) moveX = 0.08;

        // Ladder climbing
        const pr = Math.floor(this.playerR);
        const pc = Math.floor(this.playerC);
        this.onLadder = this._isLadder(pr, pc);

        if (this.onLadder) {
            if (this.cursors.up.isDown || this.wasd.w.isDown) moveY = -0.06;
            if (this.cursors.down.isDown || this.wasd.s.isDown) moveY = 0.06;
            this.playerVY = 0;
        } else {
            // Jump
            if ((this.cursors.up.isDown || this.wasd.w.isDown) && this.isGrounded) {
                this.playerVY = -0.22;
                this.isGrounded = false;
            }
            // Gravity
            this.playerVY += 0.012;
        }

        // Apply movement
        this.playerC += moveX;
        this.playerR += moveY + this.playerVY;

        // Horizontal collision
        if (this._isSolid(Math.floor(this.playerR), Math.floor(this.playerC - 0.3))) {
            this.playerC = Math.floor(this.playerC - 0.3) + 1.3;
        }
        if (this._isSolid(Math.floor(this.playerR), Math.floor(this.playerC + 0.3))) {
            this.playerC = Math.floor(this.playerC + 0.3) - 0.3;
        }

        // Vertical collision
        if (this.playerVY > 0 && this._isSolid(Math.floor(this.playerR + 0.5), pc)) {
            this.playerR = Math.floor(this.playerR + 0.5) - 0.5;
            this.playerVY = 0;
            this.isGrounded = true;
        }
        if (this.playerVY < 0 && this._isSolid(Math.floor(this.playerR - 0.5), pc)) {
            this.playerR = Math.floor(this.playerR - 0.5) + 1.5;
            this.playerVY = 0;
        }

        // --- Enemies ---
        this.enemies.forEach(e => {
            if (!e.active) return;
            e.c += e.dir * e.speed;
            if (e.c > e.endC || e.c < e.startC) e.dir *= -1;

            // Player collision
            const dx = Math.abs(this.playerC - e.c);
            const dy = this.playerR - e.r;

            if (dx < 0.6 && Math.abs(dy) < 0.6) {
                if (this.playerVY > 0 && dy < -0.1) {
                    // Stomp!
                    e.active = false;
                    this.playerVY = -0.15;
                    this.score += 100;
                    Launcher.updateScore(this.score);
                } else {
                    // Hit by enemy
                    this.lives--;
                    this.livesText.setText(`Lives: ${this.lives}`);
                    this.playerR = 1;
                    this.playerC = 1.5;
                    this.playerVY = 0;
                    if (this.lives <= 0) {
                        this.add.text(this.scale.width / 2, this.scale.height / 2, 'GAME OVER', {
                            fontSize: '28px', color: '#E53935',
                            fontFamily: 'sans-serif', fontStyle: 'bold'
                        }).setOrigin(0.5).setDepth(20);
                        this.scene.pause();
                    }
                }
            }
        });

        // Principal collision (win)
        if (this.principalPos) {
            const dx = Math.abs(this.playerC - this.principalPos.c - 0.5);
            const dy = Math.abs(this.playerR - this.principalPos.r - 0.5);
            if (dx < 0.8 && dy < 0.8) {
                this.gameWon = true;
                this.score += 500;
                Launcher.updateScore(this.score);
                this.add.text(this.scale.width / 2, this.scale.height / 2,
                    'PRINCIPAL FOUND!', {
                        fontSize: '28px', color: '#FFD700',
                        fontFamily: 'sans-serif', fontStyle: 'bold'
                    }).setOrigin(0.5).setDepth(20);
            }
        }

        // --- Draw sprites ---
        this.spriteGraphics.clear();

        // Player
        const px = this.gridOffsetX + this.playerC * ts;
        const py = this.gridOffsetY + this.playerR * ts;
        this.spriteGraphics.fillStyle(0xE53935, 1);
        this.spriteGraphics.fillRoundedRect(px - 8, py - 14, 16, 26, 3);
        this.spriteGraphics.fillStyle(0xFDD835, 0.8);
        this.spriteGraphics.fillRect(px - 6, py - 2, 12, 3);
        this.spriteGraphics.fillStyle(0xffffff, 1);
        this.spriteGraphics.fillCircle(px - 2, py - 8, 2);
        this.spriteGraphics.fillCircle(px + 2, py - 8, 2);

        // Enemies
        this.enemies.forEach(e => {
            if (!e.active) return;
            const ex = this.gridOffsetX + e.c * ts;
            const ey = this.gridOffsetY + e.r * ts;
            this.spriteGraphics.fillStyle(0x7E57C2, 1);
            this.spriteGraphics.fillRoundedRect(ex - 8, ey - 10, 16, 20, 3);
            this.spriteGraphics.fillStyle(0xFF5252, 1);
            this.spriteGraphics.fillCircle(ex - 2, ey - 5, 2);
            this.spriteGraphics.fillCircle(ex + 2, ey - 5, 2);
        });
    }
}

GameRegistry.register({
    id: 'FindThePrincipal',
    title: 'Find the Principal',
    classic: 'Save the Sheriff',
    character: 'guha',
    mechanic: 'Platforming with enemy stomp and ladder logic',
    iconColor: '#C62828',
    iconEmoji: '🏫',
    scene: FindThePrincipal
});
