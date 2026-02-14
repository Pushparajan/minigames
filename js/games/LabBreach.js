/**
 * Game 5: Lab Breach
 * ====================
 * Classic: Commando 2 | Character: Zack (Computer Science)
 * Mechanic: Side-scrolling run-and-gun with holographic pixel projectiles.
 */

class LabBreach extends Phaser.Scene {
    constructor() {
        super({ key: 'LabBreach' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.groundY = height - 50;
        this.playerHP = 5;
        this.scrollX = 0;
        this.scrollSpeed = 2;
        this.bullets = [];
        this.enemies = [];
        this.enemyTimer = 0;
        this.isJumping = false;
        this.playerVY = 0;

        // --- Background layers ---
        this.bgGraphics = this.add.graphics();
        this.fgGraphics = this.add.graphics();
        this.bulletGraphics = this.add.graphics().setDepth(6);
        this.enemyGraphics = this.add.graphics().setDepth(4);

        // Player
        const charKey = CharacterFactory.createTexture(this, 'zack', 2);
        this.playerSprite = this.add.image(width * 0.2, this.groundY - 30, charKey).setDepth(5);
        this.playerX = width * 0.2;
        this.playerY = this.groundY - 30;

        // HUD
        this.hpText = this.add.text(10, 10, `HP: ${this.playerHP}`, {
            fontSize: '13px', color: '#00E676', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.add.text(width / 2, height - 15, 'Tap/Click to shoot | UP/W or Swipe Up to jump', {
            fontSize: '11px', color: '#555588', fontFamily: 'sans-serif'
        }).setOrigin(0.5);

        // Input
        this.keys = this.input.keyboard.addKeys({
            up: 'W', jump: 'UP', shoot: 'SPACE'
        });
        this.input.on('pointerdown', (p) => {
            this._shoot();
            if (p.y < this.playerY - 50) this._jump();
        });
        this.input.keyboard.on('keydown-SPACE', () => this._shoot());
        this.input.keyboard.on('keydown-UP', () => this._jump());
        this.input.keyboard.on('keydown-W', () => this._jump());
    }

    _jump() {
        if (!this.isJumping) {
            this.isJumping = true;
            this.playerVY = -10;
        }
    }

    _shoot() {
        this.bullets.push({
            x: this.playerX + 20,
            y: this.playerY,
            vx: 8,
            life: 60
        });
    }

    _spawnEnemy() {
        const { width } = this.scale;
        this.enemies.push({
            x: width + 20,
            y: this.groundY - 25 - Math.random() * 10,
            speed: 1.5 + Math.random() * 2,
            hp: 1,
            size: 18,
            shootTimer: Phaser.Math.Between(60, 120)
        });
    }

    update() {
        const { width, height } = this.scale;
        this.scrollX += this.scrollSpeed;

        // Draw scrolling background
        this.bgGraphics.clear();
        this.bgGraphics.fillGradientStyle(0x0a0a1e, 0x0a0a1e, 0x1a1a3e, 0x1a1a3e, 1);
        this.bgGraphics.fillRect(0, 0, width, height);

        // Floor with scroll effect
        this.fgGraphics.clear();
        this.fgGraphics.fillStyle(0x2a2a4a, 1);
        this.fgGraphics.fillRect(0, this.groundY, width, height - this.groundY);
        // Floor line tiles
        this.fgGraphics.lineStyle(1, 0x3a3a5a, 0.5);
        for (let x = -(this.scrollX % 40); x < width; x += 40) {
            this.fgGraphics.beginPath();
            this.fgGraphics.moveTo(x, this.groundY);
            this.fgGraphics.lineTo(x, height);
            this.fgGraphics.strokePath();
        }

        // Background structures
        this.bgGraphics.fillStyle(0x1a1a3a, 0.6);
        for (let x = -(this.scrollX * 0.3 % 200); x < width; x += 200) {
            this.bgGraphics.fillRect(x, this.groundY - 100 - (x % 3) * 20, 60, 100 + (x % 3) * 20);
        }

        // --- Player gravity ---
        if (this.isJumping) {
            this.playerVY += 0.5;
            this.playerY += this.playerVY;
            if (this.playerY >= this.groundY - 30) {
                this.playerY = this.groundY - 30;
                this.playerVY = 0;
                this.isJumping = false;
            }
        }
        this.playerSprite.setPosition(this.playerX, this.playerY);

        // --- Bullets ---
        this.bulletGraphics.clear();
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.x += b.vx;
            b.life--;

            if (b.life <= 0 || b.x > width + 10) {
                this.bullets.splice(i, 1);
                continue;
            }

            // Holographic pixel projectile
            this.bulletGraphics.fillStyle(0x00E676, 0.9);
            this.bulletGraphics.fillRect(b.x - 4, b.y - 2, 8, 4);
            this.bulletGraphics.fillStyle(0x76FF03, 0.5);
            this.bulletGraphics.fillRect(b.x - 6, b.y - 1, 4, 2);
        }

        // --- Enemies ---
        this.enemyTimer++;
        if (this.enemyTimer >= 90) {
            this._spawnEnemy();
            this.enemyTimer = 0;
        }

        this.enemyGraphics.clear();
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            e.x -= e.speed + this.scrollSpeed;

            if (e.x < -30) {
                this.enemies.splice(i, 1);
                continue;
            }

            // Draw enemy bot
            this.enemyGraphics.fillStyle(0x7E57C2, 1);
            this.enemyGraphics.fillRoundedRect(e.x - e.size / 2, e.y - e.size / 2,
                e.size, e.size, 3);
            this.enemyGraphics.fillStyle(0xFF5252, 1);
            this.enemyGraphics.fillCircle(e.x - 3, e.y - 3, 2);
            this.enemyGraphics.fillCircle(e.x + 3, e.y - 3, 2);

            // Bullet collision
            for (let j = this.bullets.length - 1; j >= 0; j--) {
                const b = this.bullets[j];
                if (Math.abs(b.x - e.x) < e.size && Math.abs(b.y - e.y) < e.size) {
                    e.hp--;
                    this.bullets.splice(j, 1);
                    if (e.hp <= 0) {
                        this.score += 30;
                        Launcher.updateScore(this.score);
                        this.enemies.splice(i, 1);
                    }
                    break;
                }
            }

            // Player collision
            if (Math.abs(e.x - this.playerX) < 25 && Math.abs(e.y - this.playerY) < 25) {
                this.playerHP--;
                this.hpText.setText(`HP: ${this.playerHP}`);
                this.enemies.splice(i, 1);
                if (this.playerHP <= 0) {
                    this.add.text(width / 2, height / 2, 'LAB SECURED... GAME OVER', {
                        fontSize: '24px', color: '#00E676',
                        fontFamily: 'sans-serif', fontStyle: 'bold'
                    }).setOrigin(0.5).setDepth(20);
                    this.scene.pause();
                }
            }
        }
    }
}

GameRegistry.register({
    id: 'LabBreach',
    title: 'Lab Breach',
    classic: 'Commando 2',
    character: 'zack',
    mechanic: 'Side-scrolling run-and-gun with holographic projectiles',
    iconColor: '#1B5E20',
    iconEmoji: '🔫',
    scene: LabBreach
});
