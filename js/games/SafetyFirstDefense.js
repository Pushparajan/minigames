/**
 * Game 8: Safety First Defense
 * ===============================
 * Classic: Bush Shoot-Out | Character: Sofia (Engineering)
 * Mechanic: Point-and-click "Duck and Cover" cover-based shooting logic.
 */

class SafetyFirstDefense extends Phaser.Scene {
    constructor() {
        super({ key: 'SafetyFirstDefense' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.playerHP = 5;
        this.ammo = 12;
        this.maxAmmo = 12;
        this.isInCover = true;
        this.reloading = false;
        this.enemies = [];
        this.enemyBullets = [];
        this.enemyTimer = 0;
        this.wave = 1;
        this.enemiesDefeated = 0;

        // --- Background: Lab corridor ---
        const bg = this.add.graphics();
        bg.fillStyle(0x2a2a3e, 1);
        bg.fillRect(0, 0, width, height);
        // Floor
        bg.fillStyle(0x3a3a4e, 1);
        bg.fillRect(0, height * 0.7, width, height * 0.3);
        // Perspective lines
        bg.lineStyle(1, 0x4a4a5e, 0.3);
        for (let x = 0; x < width; x += 40) {
            bg.beginPath();
            bg.moveTo(x, height * 0.7);
            bg.lineTo(width / 2, height * 0.3);
            bg.strokePath();
        }

        // Cover barriers (3 positions)
        this.covers = [
            { x: width * 0.2, y: height * 0.72, w: 70, h: 40 },
            { x: width * 0.5, y: height * 0.72, w: 70, h: 40 },
            { x: width * 0.8, y: height * 0.72, w: 70, h: 40 }
        ];
        this.currentCover = 1;

        const coverG = this.add.graphics().setDepth(3);
        this.covers.forEach(c => {
            coverG.fillStyle(0x546E7A, 1);
            coverG.fillRoundedRect(c.x - c.w / 2, c.y, c.w, c.h, 4);
            coverG.lineStyle(2, 0x78909C, 1);
            coverG.strokeRoundedRect(c.x - c.w / 2, c.y, c.w, c.h, 4);
        });

        // Player (behind cover)
        const charKey = CharacterFactory.createTexture(this, 'sofia', 2);
        this.playerSprite = this.add.image(
            this.covers[this.currentCover].x,
            this.covers[this.currentCover].y - 10,
            charKey
        ).setDepth(4);

        // Graphics layers
        this.enemyGraphics = this.add.graphics().setDepth(2);
        this.bulletGraphics = this.add.graphics().setDepth(5);
        this.crosshairGraphics = this.add.graphics().setDepth(8);

        // HUD
        this.hpText = this.add.text(10, 10, `HP: ${this.playerHP}`, {
            fontSize: '13px', color: '#E53935', fontFamily: 'sans-serif'
        }).setDepth(10);
        this.ammoText = this.add.text(10, 28, `Ammo: ${this.ammo}/${this.maxAmmo}`, {
            fontSize: '13px', color: '#FFD54F', fontFamily: 'sans-serif'
        }).setDepth(10);
        this.waveText = this.add.text(width / 2, 10, `Wave ${this.wave}`, {
            fontSize: '14px', color: '#ffffff', fontFamily: 'sans-serif'
        }).setOrigin(0.5, 0).setDepth(10);

        this.statusText = this.add.text(width / 2, height - 20,
            'IN COVER - Click enemies to shoot | A/D to switch cover', {
                fontSize: '11px', color: '#90A4AE', fontFamily: 'sans-serif'
            }).setOrigin(0.5).setDepth(10);

        // Input
        this.input.on('pointerdown', this._onShoot, this);
        this.input.keyboard.on('keydown-A', () => this._switchCover(-1));
        this.input.keyboard.on('keydown-D', () => this._switchCover(1));
        this.input.keyboard.on('keydown-LEFT', () => this._switchCover(-1));
        this.input.keyboard.on('keydown-RIGHT', () => this._switchCover(1));
        this.input.keyboard.on('keydown-R', () => this._reload());
        this.input.keyboard.on('keydown-SPACE', () => this._toggleCover());
        this.input.on('pointermove', (p) => { this.aimX = p.x; this.aimY = p.y; });

        this.aimX = width / 2;
        this.aimY = height / 2;

        // Spawn first wave
        this._spawnWave();
    }

    _switchCover(dir) {
        const nc = this.currentCover + dir;
        if (nc >= 0 && nc < this.covers.length) {
            this.currentCover = nc;
            const c = this.covers[this.currentCover];
            this.playerSprite.setPosition(c.x, this.isInCover ? c.y - 10 : c.y - 40);
            this.isInCover = true;
            this.statusText.setText('IN COVER');
        }
    }

    _toggleCover() {
        this.isInCover = !this.isInCover;
        const c = this.covers[this.currentCover];
        this.playerSprite.setY(this.isInCover ? c.y - 10 : c.y - 45);
        this.statusText.setText(this.isInCover ? 'IN COVER' : 'EXPOSED - SHOOT!');
    }

    _reload() {
        if (this.reloading) return;
        this.reloading = true;
        this.statusText.setText('RELOADING...');
        this.time.delayedCall(1200, () => {
            this.ammo = this.maxAmmo;
            this.ammoText.setText(`Ammo: ${this.ammo}/${this.maxAmmo}`);
            this.reloading = false;
            this.statusText.setText(this.isInCover ? 'IN COVER' : 'READY');
        });
    }

    _onShoot(pointer) {
        // Pop out of cover to shoot
        if (this.isInCover) {
            this._toggleCover();
            return;
        }

        if (this.ammo <= 0 || this.reloading) {
            this._reload();
            return;
        }

        this.ammo--;
        this.ammoText.setText(`Ammo: ${this.ammo}/${this.maxAmmo}`);

        // Check hit on enemies
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            if (!e.active) continue;
            const dx = pointer.x - e.x;
            const dy = pointer.y - e.y;
            if (Math.sqrt(dx * dx + dy * dy) < e.size + 10) {
                e.hp--;
                if (e.hp <= 0) {
                    e.active = false;
                    this.score += 100;
                    Launcher.updateScore(this.score);
                    this.enemiesDefeated++;
                }
                break;
            }
        }

        // Auto-return to cover
        this.time.delayedCall(600, () => {
            if (!this.isInCover) this._toggleCover();
        });
    }

    _spawnWave() {
        const { width } = this.scale;
        const count = 2 + this.wave;
        for (let i = 0; i < count; i++) {
            this.enemies.push({
                x: Phaser.Math.Between(50, width - 50),
                y: Phaser.Math.Between(80, 220),
                hp: 1,
                active: true,
                size: 16,
                shootTimer: Phaser.Math.Between(80, 200),
                shootCooldown: Phaser.Math.Between(80, 200),
                peekTimer: 0,
                visible: true
            });
        }
    }

    update() {
        const { width, height } = this.scale;

        // --- Draw crosshair ---
        this.crosshairGraphics.clear();
        if (!this.isInCover) {
            this.crosshairGraphics.lineStyle(1.5, 0xff4444, 0.8);
            this.crosshairGraphics.strokeCircle(this.aimX, this.aimY, 10);
            this.crosshairGraphics.beginPath();
            this.crosshairGraphics.moveTo(this.aimX - 15, this.aimY);
            this.crosshairGraphics.lineTo(this.aimX + 15, this.aimY);
            this.crosshairGraphics.moveTo(this.aimX, this.aimY - 15);
            this.crosshairGraphics.lineTo(this.aimX, this.aimY + 15);
            this.crosshairGraphics.strokePath();
        }

        // --- Draw enemies ---
        this.enemyGraphics.clear();
        let activeCount = 0;

        this.enemies.forEach(e => {
            if (!e.active) return;
            activeCount++;

            // Enemy shooting
            e.shootTimer--;
            if (e.shootTimer <= 0 && !this.isInCover) {
                // Shoot at player
                const c = this.covers[this.currentCover];
                this.enemyBullets.push({
                    x: e.x, y: e.y,
                    vx: (c.x - e.x) * 0.02,
                    vy: (c.y - 30 - e.y) * 0.02,
                    life: 60
                });
                e.shootTimer = e.shootCooldown;
            }

            // Draw enemy
            this.enemyGraphics.fillStyle(0x7E57C2, 1);
            this.enemyGraphics.fillRoundedRect(e.x - e.size / 2, e.y - e.size,
                e.size, e.size * 1.5, 3);
            // Eyes
            this.enemyGraphics.fillStyle(0xff4444, 1);
            this.enemyGraphics.fillCircle(e.x - 3, e.y - e.size * 0.5, 2);
            this.enemyGraphics.fillCircle(e.x + 3, e.y - e.size * 0.5, 2);
        });

        // --- Enemy bullets ---
        this.bulletGraphics.clear();
        for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
            const b = this.enemyBullets[i];
            b.x += b.vx;
            b.y += b.vy;
            b.life--;

            if (b.life <= 0) {
                this.enemyBullets.splice(i, 1);
                continue;
            }

            this.bulletGraphics.fillStyle(0xFF5252, 1);
            this.bulletGraphics.fillCircle(b.x, b.y, 3);

            // Hit player (only if not in cover)
            if (!this.isInCover) {
                const c = this.covers[this.currentCover];
                if (Math.abs(b.x - c.x) < 30 && b.y > c.y - 50) {
                    this.playerHP--;
                    this.hpText.setText(`HP: ${this.playerHP}`);
                    this.enemyBullets.splice(i, 1);
                    if (this.playerHP <= 0) {
                        this.add.text(width / 2, height / 2, 'GAME OVER', {
                            fontSize: '28px', color: '#E53935',
                            fontFamily: 'sans-serif', fontStyle: 'bold'
                        }).setOrigin(0.5).setDepth(20);
                        this.scene.pause();
                    }
                }
            }
        }

        // Next wave
        if (activeCount === 0 && this.enemies.length > 0) {
            this.wave++;
            this.waveText.setText(`Wave ${this.wave}`);
            this.enemies = [];
            this.time.delayedCall(1500, () => this._spawnWave());
        }
    }

    shutdown() {
        this.enemies = [];
        this.enemyBullets = [];
    }
}

GameRegistry.register({
    id: 'SafetyFirstDefense',
    title: 'Safety First Defense',
    classic: 'Bush Shoot-Out',
    character: 'sofia',
    mechanic: 'Point-and-click duck-and-cover shooting',
    iconColor: '#37474F',
    iconEmoji: '🛡',
    scene: SafetyFirstDefense
});
