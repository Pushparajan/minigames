/**
 * Game 4: Drone Defense
 * =======================
 * Classic: Heli Attack | Character: Guha (Physics)
 * Mechanic: 360-degree mouse/touch aiming and gravity-based jetpack.
 */

class DroneDefense extends Phaser.Scene {
    constructor() {
        super({ key: 'DroneDefense' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.groundY = height - 60;
        this.ammo = 50;
        this.fuel = 100;
        this.playerHP = 5;
        this.bullets = [];
        this.enemies = [];
        this.particles = [];
        this.enemyTimer = 0;
        this.enemyInterval = 120; // frames between spawns

        // --- Background ---
        const bg = this.add.graphics();
        bg.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x16213e, 0x16213e, 1);
        bg.fillRect(0, 0, width, height);
        // Ground
        bg.fillStyle(0x2d4a22, 1);
        bg.fillRect(0, this.groundY, width, height - this.groundY);

        // --- Player (Guha with jetpack) ---
        this.playerX = width * 0.2;
        this.playerY = this.groundY - 30;
        this.playerVY = 0;
        this.jetpackOn = false;

        const charKey = CharacterFactory.createTexture(this, 'guha', 2);
        this.playerSprite = this.add.image(this.playerX, this.playerY, charKey).setDepth(5);

        // --- Crosshair ---
        this.crosshair = this.add.graphics().setDepth(10);
        this.aimAngle = 0;

        // --- HUD ---
        this.hpText = this.add.text(10, 10, `HP: ${this.playerHP}`, {
            fontSize: '13px', color: '#E53935', fontFamily: 'sans-serif'
        }).setDepth(10);
        this.ammoText = this.add.text(10, 28, `Ammo: ${this.ammo}`, {
            fontSize: '13px', color: '#FDD835', fontFamily: 'sans-serif'
        }).setDepth(10);
        this.fuelText = this.add.text(10, 46, `Fuel: ${Math.round(this.fuel)}`, {
            fontSize: '13px', color: '#64B5F6', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.add.text(width / 2, height - 15, 'Click/Tap to shoot | Hold right/bottom to jetpack', {
            fontSize: '11px', color: '#555588', fontFamily: 'sans-serif'
        }).setOrigin(0.5);

        // --- Graphics layers ---
        this.bulletGraphics = this.add.graphics().setDepth(6);
        this.enemyGraphics = this.add.graphics().setDepth(4);
        this.particleGraphics = this.add.graphics().setDepth(7);

        // --- Input ---
        this.input.on('pointerdown', this._onShoot, this);
        this.input.on('pointermove', this._onAim, this);

        // Keyboard
        this.keys = this.input.keyboard.addKeys({
            up: 'W', left: 'A', right: 'D', space: 'SPACE'
        });
    }

    _onAim(pointer) {
        const dx = pointer.x - this.playerX;
        const dy = pointer.y - this.playerY;
        this.aimAngle = Math.atan2(dy, dx);
    }

    _onShoot(pointer) {
        if (this.ammo <= 0) return;
        this.ammo--;
        this.ammoText.setText(`Ammo: ${this.ammo}`);

        const dx = pointer.x - this.playerX;
        const dy = pointer.y - this.playerY;
        const angle = Math.atan2(dy, dx);
        const speed = 10;

        this.bullets.push({
            x: this.playerX,
            y: this.playerY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 80
        });
    }

    _spawnEnemy() {
        const { width, height } = this.scale;
        const side = Math.random() > 0.5 ? width + 20 : -20;
        const y = Phaser.Math.Between(60, this.groundY - 40);
        const speed = Phaser.Math.FloatBetween(1, 3);

        this.enemies.push({
            x: side,
            y: y,
            vx: side > width ? -speed : speed,
            vy: Math.sin(Math.random() * Math.PI) * 0.5,
            hp: 1,
            size: Phaser.Math.Between(12, 20),
            color: Phaser.Math.Between(0, 1) > 0.5 ? 0x7E57C2 : 0xE53935
        });
    }

    _spawnParticle(x, y, color) {
        for (let i = 0; i < 6; i++) {
            this.particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 4,
                vy: (Math.random() - 0.5) * 4,
                life: 20,
                color: color
            });
        }
    }

    update() {
        const { width, height } = this.scale;

        // --- Jetpack / Gravity ---
        const spaceDown = this.keys.space.isDown;
        const pointerDown = this.input.activePointer.isDown && this.input.activePointer.y < this.playerY;

        if ((spaceDown || pointerDown) && this.fuel > 0) {
            this.playerVY -= 0.6;
            this.fuel = Math.max(0, this.fuel - 0.3);
            this.fuelText.setText(`Fuel: ${Math.round(this.fuel)}`);
        }

        this.playerVY += 0.35; // gravity
        this.playerY += this.playerVY;

        // Clamp to ground
        if (this.playerY >= this.groundY - 30) {
            this.playerY = this.groundY - 30;
            this.playerVY = 0;
            // Refuel on ground
            if (this.fuel < 100) this.fuel = Math.min(100, this.fuel + 0.2);
            this.fuelText.setText(`Fuel: ${Math.round(this.fuel)}`);
        }
        if (this.playerY < 20) {
            this.playerY = 20;
            this.playerVY = 0;
        }

        // Horizontal movement
        if (this.keys.left.isDown) this.playerX = Math.max(20, this.playerX - 3);
        if (this.keys.right.isDown) this.playerX = Math.min(width - 20, this.playerX + 3);

        this.playerSprite.setPosition(this.playerX, this.playerY);

        // --- Crosshair ---
        this.crosshair.clear();
        const cx = this.playerX + Math.cos(this.aimAngle) * 50;
        const cy = this.playerY + Math.sin(this.aimAngle) * 50;
        this.crosshair.lineStyle(1.5, 0x00ff00, 0.8);
        this.crosshair.strokeCircle(cx, cy, 8);
        this.crosshair.beginPath();
        this.crosshair.moveTo(cx - 12, cy);
        this.crosshair.lineTo(cx + 12, cy);
        this.crosshair.moveTo(cx, cy - 12);
        this.crosshair.lineTo(cx, cy + 12);
        this.crosshair.strokePath();

        // --- Bullets ---
        this.bulletGraphics.clear();
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.x += b.vx;
            b.y += b.vy;
            b.life--;

            if (b.life <= 0 || b.x < -10 || b.x > width + 10 || b.y < -10 || b.y > height + 10) {
                this.bullets.splice(i, 1);
                continue;
            }

            this.bulletGraphics.fillStyle(0xFFEB3B, 1);
            this.bulletGraphics.fillCircle(b.x, b.y, 3);
        }

        // --- Enemies ---
        this.enemyTimer++;
        if (this.enemyTimer >= this.enemyInterval) {
            this._spawnEnemy();
            this.enemyTimer = 0;
            this.enemyInterval = Math.max(40, this.enemyInterval - 1);
        }

        this.enemyGraphics.clear();
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            e.x += e.vx;
            e.y += Math.sin(this.time.now / 500 + i) * 0.5;

            // Off-screen removal
            if (e.x < -50 || e.x > width + 50) {
                this.enemies.splice(i, 1);
                continue;
            }

            // Draw enemy drone
            this.enemyGraphics.fillStyle(e.color, 1);
            this.enemyGraphics.fillRoundedRect(e.x - e.size / 2, e.y - e.size / 3,
                e.size, e.size * 0.66, 3);
            // Propellers
            this.enemyGraphics.lineStyle(2, 0xcccccc, 0.7);
            this.enemyGraphics.beginPath();
            this.enemyGraphics.moveTo(e.x - e.size * 0.6, e.y - e.size * 0.3);
            this.enemyGraphics.lineTo(e.x + e.size * 0.6, e.y - e.size * 0.3);
            this.enemyGraphics.strokePath();

            // Bullet collision
            for (let j = this.bullets.length - 1; j >= 0; j--) {
                const b = this.bullets[j];
                const dx = b.x - e.x;
                const dy = b.y - e.y;
                if (Math.sqrt(dx * dx + dy * dy) < e.size) {
                    e.hp--;
                    this.bullets.splice(j, 1);
                    this._spawnParticle(e.x, e.y, e.color);
                    if (e.hp <= 0) {
                        this.score += 50;
                        Launcher.updateScore(this.score);
                        // Ammo drop chance
                        if (Math.random() < 0.3) this.ammo = Math.min(99, this.ammo + 5);
                        this.ammoText.setText(`Ammo: ${this.ammo}`);
                        this.enemies.splice(i, 1);
                    }
                    break;
                }
            }

            // Collide with player
            if (e.x > -40 && e.x < width + 40) {
                const pdx = e.x - this.playerX;
                const pdy = e.y - this.playerY;
                if (Math.sqrt(pdx * pdx + pdy * pdy) < e.size + 15) {
                    this.playerHP--;
                    this.hpText.setText(`HP: ${this.playerHP}`);
                    this._spawnParticle(e.x, e.y, 0xff0000);
                    this.enemies.splice(i, 1);
                    if (this.playerHP <= 0) {
                        this.add.text(width / 2, height / 2, 'GAME OVER', {
                            fontSize: '32px', color: '#E53935',
                            fontFamily: 'sans-serif', fontStyle: 'bold'
                        }).setOrigin(0.5).setDepth(20);
                        this.scene.pause();
                    }
                }
            }
        }

        // --- Particles ---
        this.particleGraphics.clear();
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            this.particleGraphics.fillStyle(p.color, p.life / 20);
            this.particleGraphics.fillCircle(p.x, p.y, 2);
        }
    }

    shutdown() {
        this.bullets = [];
        this.enemies = [];
        this.particles = [];
    }
}

GameRegistry.register({
    id: 'DroneDefense',
    title: 'Drone Defense',
    classic: 'Heli Attack',
    character: 'guha',
    mechanic: '360-degree aiming and gravity-based jetpack',
    iconColor: '#16213e',
    iconEmoji: '🚁',
    scene: DroneDefense
});
