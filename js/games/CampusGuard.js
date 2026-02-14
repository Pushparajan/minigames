/**
 * Game 18: Campus Guard
 * =======================
 * Classic: Canyon Defense | Character: Dev (Mathematics)
 * Mechanic: Tower Defense — pathfinding enemies and range-detection turrets.
 */

class CampusGuard extends Phaser.Scene {
    constructor() {
        super({ key: 'CampusGuard' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.gold = 100;
        this.lives = 10;
        this.wave = 0;
        this.enemies = [];
        this.turrets = [];
        this.bullets = [];
        this.waveTimer = 0;
        this.spawning = false;
        this.spawnQueue = [];

        this.tileSize = 40;
        this.cols = Math.floor(width / this.tileSize);
        this.rows = Math.floor((height - 60) / this.tileSize);
        this.gridOffsetY = 50;

        // Path (enemy route through grid)
        this.path = this._generatePath();

        // Graphics
        this.gridGraphics = this.add.graphics();
        this.turretGraphics = this.add.graphics().setDepth(4);
        this.enemyGraphics = this.add.graphics().setDepth(3);
        this.bulletGraphics = this.add.graphics().setDepth(5);
        this.rangeGraphics = this.add.graphics().setDepth(1);

        // HUD
        const charKey = CharacterFactory.createTexture(this, 'dev', 1);
        this.add.image(25, 15, charKey).setDepth(10);
        this.add.text(50, 5, 'Dev - Campus Guard', {
            fontSize: '11px', color: '#FFD54F', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.goldText = this.add.text(width / 2 - 60, 5, `Gold: ${this.gold}`, {
            fontSize: '12px', color: '#FFD700', fontFamily: 'sans-serif'
        }).setDepth(10);
        this.livesText = this.add.text(width / 2 + 20, 5, `Lives: ${this.lives}`, {
            fontSize: '12px', color: '#E53935', fontFamily: 'sans-serif'
        }).setDepth(10);
        this.waveText = this.add.text(width - 10, 5, `Wave: ${this.wave}`, {
            fontSize: '12px', color: '#90A4AE', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);

        this.add.text(width / 2, 25, 'Click empty tile to place turret (20 gold)', {
            fontSize: '10px', color: '#777799', fontFamily: 'sans-serif'
        }).setOrigin(0.5, 0).setDepth(10);

        // Input
        this.input.on('pointerdown', this._onPlace, this);

        this._drawGrid();
        this._startWave();
    }

    _generatePath() {
        // S-shaped path
        const path = [];
        const mid = Math.floor(this.rows / 2);

        // Enter from left
        for (let c = 0; c < Math.floor(this.cols * 0.4); c++) path.push({ r: 1, c });
        // Go down
        for (let r = 1; r <= mid + 2; r++) path.push({ r, c: Math.floor(this.cols * 0.4) });
        // Go right
        for (let c = Math.floor(this.cols * 0.4); c < Math.floor(this.cols * 0.7); c++) path.push({ r: mid + 2, c });
        // Go up
        for (let r = mid + 2; r >= 1; r--) path.push({ r, c: Math.floor(this.cols * 0.7) });
        // Exit right
        for (let c = Math.floor(this.cols * 0.7); c < this.cols; c++) path.push({ r: 1, c });

        return path;
    }

    _drawGrid() {
        const g = this.gridGraphics;
        g.clear();

        // Background
        g.fillStyle(0x2E7D32, 1);
        g.fillRect(0, this.gridOffsetY, this.scale.width, this.scale.height - this.gridOffsetY);

        // Grid lines
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const x = c * this.tileSize;
                const y = this.gridOffsetY + r * this.tileSize;
                g.lineStyle(1, 0x1B5E20, 0.3);
                g.strokeRect(x, y, this.tileSize, this.tileSize);
            }
        }

        // Path
        this.path.forEach(p => {
            const x = p.c * this.tileSize;
            const y = this.gridOffsetY + p.r * this.tileSize;
            g.fillStyle(0x8D6E63, 1);
            g.fillRect(x, y, this.tileSize, this.tileSize);
        });

        // Entry and exit markers
        if (this.path.length > 0) {
            const start = this.path[0];
            const end = this.path[this.path.length - 1];
            g.fillStyle(0x4CAF50, 1);
            g.fillCircle(start.c * this.tileSize + this.tileSize / 2,
                this.gridOffsetY + start.r * this.tileSize + this.tileSize / 2, 8);
            g.fillStyle(0xE53935, 1);
            g.fillCircle(end.c * this.tileSize + this.tileSize / 2,
                this.gridOffsetY + end.r * this.tileSize + this.tileSize / 2, 8);
        }
    }

    _onPlace(pointer) {
        if (this.gold < 20) return;

        const c = Math.floor(pointer.x / this.tileSize);
        const r = Math.floor((pointer.y - this.gridOffsetY) / this.tileSize);

        if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return;

        // Can't place on path
        if (this.path.some(p => p.r === r && p.c === c)) return;
        // Can't place on existing turret
        if (this.turrets.some(t => t.r === r && t.c === c)) return;

        this.gold -= 20;
        this.goldText.setText(`Gold: ${this.gold}`);

        this.turrets.push({
            r, c,
            x: c * this.tileSize + this.tileSize / 2,
            y: this.gridOffsetY + r * this.tileSize + this.tileSize / 2,
            range: 80,
            fireRate: 40,
            timer: 0,
            damage: 1,
            angle: 0
        });
    }

    _startWave() {
        this.wave++;
        this.waveText.setText(`Wave: ${this.wave}`);

        const count = 4 + this.wave * 2;
        this.spawnQueue = [];
        for (let i = 0; i < count; i++) {
            this.spawnQueue.push({
                hp: 2 + Math.floor(this.wave * 0.5),
                speed: 0.005 + Math.random() * 0.005,
                delay: i * 30
            });
        }
        this.spawning = true;
        this.waveTimer = 0;
    }

    update() {
        const { width, height } = this.scale;

        // --- Spawn enemies ---
        if (this.spawning) {
            this.waveTimer++;
            for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
                if (this.waveTimer >= this.spawnQueue[i].delay) {
                    const sp = this.spawnQueue.splice(i, 1)[0];
                    this.enemies.push({
                        pathIndex: 0,
                        pathT: 0,
                        hp: sp.hp,
                        maxHP: sp.hp,
                        speed: sp.speed,
                        x: this.path[0].c * this.tileSize + this.tileSize / 2,
                        y: this.gridOffsetY + this.path[0].r * this.tileSize + this.tileSize / 2
                    });
                }
            }
            if (this.spawnQueue.length === 0) this.spawning = false;
        }

        // --- Move enemies along path ---
        this.enemyGraphics.clear();
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            e.pathT += e.speed;

            if (e.pathT >= 1 && e.pathIndex < this.path.length - 2) {
                e.pathT = 0;
                e.pathIndex++;
            }

            if (e.pathIndex >= this.path.length - 1) {
                // Reached end
                this.lives--;
                this.livesText.setText(`Lives: ${this.lives}`);
                this.enemies.splice(i, 1);
                if (this.lives <= 0) {
                    this.add.text(width / 2, height / 2, 'CAMPUS OVERRUN!', {
                        fontSize: '28px', color: '#E53935',
                        fontFamily: 'sans-serif', fontStyle: 'bold'
                    }).setOrigin(0.5).setDepth(20);
                    this.scene.pause();
                }
                continue;
            }

            const p1 = this.path[e.pathIndex];
            const p2 = this.path[Math.min(e.pathIndex + 1, this.path.length - 1)];
            e.x = (p1.c + (p2.c - p1.c) * e.pathT) * this.tileSize + this.tileSize / 2;
            e.y = this.gridOffsetY + (p1.r + (p2.r - p1.r) * e.pathT) * this.tileSize + this.tileSize / 2;

            // Draw enemy
            this.enemyGraphics.fillStyle(0x7E57C2, 1);
            this.enemyGraphics.fillCircle(e.x, e.y, 8);
            // HP bar
            const hpRatio = e.hp / e.maxHP;
            this.enemyGraphics.fillStyle(0x333333, 1);
            this.enemyGraphics.fillRect(e.x - 8, e.y - 14, 16, 3);
            this.enemyGraphics.fillStyle(hpRatio > 0.5 ? 0x4CAF50 : 0xE53935, 1);
            this.enemyGraphics.fillRect(e.x - 8, e.y - 14, 16 * hpRatio, 3);
        }

        // --- Turrets ---
        this.turretGraphics.clear();
        this.rangeGraphics.clear();

        this.turrets.forEach(t => {
            t.timer++;

            // Find nearest enemy in range
            let target = null;
            let minDist = t.range;

            this.enemies.forEach(e => {
                const dx = e.x - t.x;
                const dy = e.y - t.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist) {
                    minDist = dist;
                    target = e;
                }
            });

            if (target) {
                t.angle = Math.atan2(target.y - t.y, target.x - t.x);

                if (t.timer >= t.fireRate) {
                    t.timer = 0;
                    this.bullets.push({
                        x: t.x, y: t.y,
                        vx: Math.cos(t.angle) * 5,
                        vy: Math.sin(t.angle) * 5,
                        damage: t.damage,
                        life: 30
                    });
                }
            }

            // Draw turret base
            this.turretGraphics.fillStyle(0x546E7A, 1);
            this.turretGraphics.fillCircle(t.x, t.y, 12);
            // Turret barrel
            this.turretGraphics.fillStyle(0x90A4AE, 1);
            this.turretGraphics.fillRect(
                t.x + Math.cos(t.angle) * 5 - 2,
                t.y + Math.sin(t.angle) * 5 - 2,
                Math.cos(t.angle) * 12,
                Math.sin(t.angle) * 12 || 4
            );
            // Range circle (subtle)
            this.rangeGraphics.lineStyle(1, 0x64B5F6, 0.15);
            this.rangeGraphics.strokeCircle(t.x, t.y, t.range);
        });

        // --- Bullets ---
        this.bulletGraphics.clear();
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.x += b.vx;
            b.y += b.vy;
            b.life--;

            if (b.life <= 0) {
                this.bullets.splice(i, 1);
                continue;
            }

            this.bulletGraphics.fillStyle(0xFFEB3B, 1);
            this.bulletGraphics.fillCircle(b.x, b.y, 3);

            // Hit enemies
            for (let j = this.enemies.length - 1; j >= 0; j--) {
                const e = this.enemies[j];
                if (Math.abs(b.x - e.x) < 10 && Math.abs(b.y - e.y) < 10) {
                    e.hp -= b.damage;
                    this.bullets.splice(i, 1);
                    if (e.hp <= 0) {
                        this.gold += 5;
                        this.goldText.setText(`Gold: ${this.gold}`);
                        this.score += 25;
                        Launcher.updateScore(this.score);
                        this.enemies.splice(j, 1);
                    }
                    break;
                }
            }
        }

        // Next wave
        if (!this.spawning && this.enemies.length === 0) {
            this.time.delayedCall(2000, () => this._startWave());
            this.spawning = true; // Prevent re-trigger
        }
    }

    shutdown() {
        this.turrets = [];
        this.enemies = [];
        this.bullets = [];
        this.particles = [];
    }
}

GameRegistry.register({
    id: 'CampusGuard',
    title: 'Campus Guard',
    classic: 'Canyon Defense',
    character: 'dev',
    mechanic: 'Tower defense with pathfinding and range turrets',
    iconColor: '#33691E',
    iconEmoji: '🗼',
    scene: CampusGuard
});
