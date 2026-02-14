/**
 * Game 22: Aero-Engineering
 * ===========================
 * Classic: Radical Aces | Character: Guha (Physics)
 * Mechanic: Top-down flight movement with 360-degree rotation.
 */

class AeroEngineering extends Phaser.Scene {
    constructor() {
        super({ key: 'AeroEngineering' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.planeX = width / 2;
        this.planeY = height / 2;
        this.planeAngle = -Math.PI / 2;
        this.planeSpeed = 2;
        this.maxSpeed = 6;
        this.hp = 5;
        this.bullets = [];
        this.enemies = [];
        this.particles = [];
        this.enemyTimer = 0;
        this.cloudScrollX = 0;

        // Graphics
        this.bgGraphics = this.add.graphics();
        this.cloudGraphics = this.add.graphics().setDepth(1);
        this.enemyGraphics = this.add.graphics().setDepth(3);
        this.bulletGraphics = this.add.graphics().setDepth(4);
        this.planeGraphics = this.add.graphics().setDepth(5);
        this.particleGraphics = this.add.graphics().setDepth(6);

        // HUD
        const charKey = CharacterFactory.createTexture(this, 'guha', 1);
        this.add.image(25, 15, charKey).setDepth(10);
        this.add.text(50, 8, 'Guha - Aero-Engineering', {
            fontSize: '11px', color: '#E53935', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.hpText = this.add.text(width - 10, 10, `HP: ${this.hp}`, {
            fontSize: '13px', color: '#E53935', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);

        this.add.text(width / 2, height - 12,
            'WASD/Arrows to fly | Space/Click to shoot', {
                fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
            }).setOrigin(0.5).setDepth(10);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({ w: 'W', a: 'A', s: 'S', d: 'D' });
        this.input.keyboard.on('keydown-SPACE', () => this._shoot());
        this.input.on('pointerdown', () => this._shoot());
        this.input.on('pointermove', (p) => {
            this.planeAngle = Math.atan2(p.y - this.planeY, p.x - this.planeX);
        });

        // Generate clouds
        this.clouds = [];
        for (let i = 0; i < 12; i++) {
            this.clouds.push({
                x: Math.random() * width,
                y: Math.random() * height,
                size: 20 + Math.random() * 40,
                speed: 0.3 + Math.random() * 0.5
            });
        }
    }

    _shoot() {
        this.bullets.push({
            x: this.planeX + Math.cos(this.planeAngle) * 20,
            y: this.planeY + Math.sin(this.planeAngle) * 20,
            vx: Math.cos(this.planeAngle) * 8,
            vy: Math.sin(this.planeAngle) * 8,
            life: 50
        });
    }

    _spawnEnemy() {
        const { width, height } = this.scale;
        const side = Phaser.Math.Between(0, 3);
        let x, y;
        switch (side) {
            case 0: x = -20; y = Math.random() * height; break;
            case 1: x = width + 20; y = Math.random() * height; break;
            case 2: x = Math.random() * width; y = -20; break;
            default: x = Math.random() * width; y = height + 20; break;
        }

        this.enemies.push({
            x, y, hp: 1,
            speed: 1.5 + Math.random(),
            angle: 0,
            size: 12 + Math.random() * 6,
            color: Math.random() > 0.5 ? 0x7E57C2 : 0xE53935,
            shootTimer: Phaser.Math.Between(60, 150)
        });
    }

    update() {
        const { width, height } = this.scale;

        // Flight controls
        if (this.cursors.left.isDown || this.wasd.a.isDown) this.planeAngle -= 0.05;
        if (this.cursors.right.isDown || this.wasd.d.isDown) this.planeAngle += 0.05;
        if (this.cursors.up.isDown || this.wasd.w.isDown) {
            this.planeSpeed = Math.min(this.maxSpeed, this.planeSpeed + 0.1);
        }
        if (this.cursors.down.isDown || this.wasd.s.isDown) {
            this.planeSpeed = Math.max(1, this.planeSpeed - 0.1);
        }

        // Move plane
        this.planeX += Math.cos(this.planeAngle) * this.planeSpeed;
        this.planeY += Math.sin(this.planeAngle) * this.planeSpeed;

        // Wrap around screen
        if (this.planeX < -20) this.planeX = width + 20;
        if (this.planeX > width + 20) this.planeX = -20;
        if (this.planeY < -20) this.planeY = height + 20;
        if (this.planeY > height + 20) this.planeY = -20;

        // --- Background ---
        this.bgGraphics.clear();
        this.bgGraphics.fillStyle(0x4A90D9, 1);
        this.bgGraphics.fillRect(0, 0, width, height);

        // Clouds
        this.cloudGraphics.clear();
        this.clouds.forEach(c => {
            c.x -= c.speed;
            if (c.x < -c.size) c.x = width + c.size;
            this.cloudGraphics.fillStyle(0xffffff, 0.3);
            this.cloudGraphics.fillCircle(c.x, c.y, c.size);
            this.cloudGraphics.fillCircle(c.x + c.size * 0.5, c.y - c.size * 0.2, c.size * 0.7);
            this.cloudGraphics.fillCircle(c.x - c.size * 0.4, c.y + c.size * 0.1, c.size * 0.6);
        });

        // --- Enemies ---
        this.enemyTimer++;
        if (this.enemyTimer >= 80) {
            this._spawnEnemy();
            this.enemyTimer = 0;
        }

        this.enemyGraphics.clear();
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];

            // Chase player
            const dx = this.planeX - e.x;
            const dy = this.planeY - e.y;
            e.angle = Math.atan2(dy, dx);
            e.x += Math.cos(e.angle) * e.speed;
            e.y += Math.sin(e.angle) * e.speed;

            // Draw enemy plane
            this._drawPlaneShape(this.enemyGraphics, e.x, e.y, e.angle, e.size, e.color);

            // Collision with player
            if (Math.sqrt(dx * dx + dy * dy) < e.size + 15) {
                this.hp--;
                this.hpText.setText(`HP: ${this.hp}`);
                this._addParticles(e.x, e.y, e.color);
                this.enemies.splice(i, 1);
                if (this.hp <= 0) {
                    this.add.text(width / 2, height / 2, 'SHOT DOWN!', {
                        fontSize: '28px', color: '#E53935',
                        fontFamily: 'sans-serif', fontStyle: 'bold'
                    }).setOrigin(0.5).setDepth(20);
                    this.scene.pause();
                }
                continue;
            }

            // Off-screen cleanup (very far)
            if (Math.abs(e.x - this.planeX) > width || Math.abs(e.y - this.planeY) > height) {
                this.enemies.splice(i, 1);
            }
        }

        // --- Bullets ---
        this.bulletGraphics.clear();
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.x += b.vx;
            b.y += b.vy;
            b.life--;

            if (b.life <= 0 || b.x < -20 || b.x > width + 20 || b.y < -20 || b.y > height + 20) {
                this.bullets.splice(i, 1);
                continue;
            }

            this.bulletGraphics.fillStyle(0xFFEB3B, 1);
            this.bulletGraphics.fillCircle(b.x, b.y, 3);

            // Hit enemies
            for (let j = this.enemies.length - 1; j >= 0; j--) {
                const e = this.enemies[j];
                if (Math.abs(b.x - e.x) < e.size && Math.abs(b.y - e.y) < e.size) {
                    e.hp--;
                    this.bullets.splice(i, 1);
                    if (e.hp <= 0) {
                        this._addParticles(e.x, e.y, e.color);
                        this.score += 50;
                        Launcher.updateScore(this.score);
                        this.enemies.splice(j, 1);
                    }
                    break;
                }
            }
        }

        // --- Draw player plane ---
        this.planeGraphics.clear();
        this._drawPlaneShape(this.planeGraphics, this.planeX, this.planeY,
            this.planeAngle, 16, 0xE53935);
        // Cockpit
        this.planeGraphics.fillStyle(0xB3E5FC, 0.8);
        this.planeGraphics.fillCircle(
            this.planeX + Math.cos(this.planeAngle) * 5,
            this.planeY + Math.sin(this.planeAngle) * 5,
            4
        );

        // Trail
        this.particleGraphics.fillStyle(0xffffff, 0.2);
        this.particleGraphics.fillCircle(
            this.planeX - Math.cos(this.planeAngle) * 18,
            this.planeY - Math.sin(this.planeAngle) * 18,
            3 + Math.random() * 2
        );

        // Particles
        this.particleGraphics.clear();
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            if (p.life <= 0) { this.particles.splice(i, 1); continue; }
            this.particleGraphics.fillStyle(p.color, p.life / 25);
            this.particleGraphics.fillCircle(p.x, p.y, 2);
        }
    }

    _drawPlaneShape(g, x, y, angle, size, color) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        g.fillStyle(color, 1);
        g.beginPath();
        g.moveTo(x + cos * size, y + sin * size); // Nose
        g.lineTo(x - cos * size * 0.8 - sin * size * 0.6, y - sin * size * 0.8 + cos * size * 0.6);
        g.lineTo(x - cos * size * 0.4, y - sin * size * 0.4); // Tail notch
        g.lineTo(x - cos * size * 0.8 + sin * size * 0.6, y - sin * size * 0.8 - cos * size * 0.6);
        g.closePath();
        g.fillPath();
    }

    _addParticles(x, y, color) {
        for (let i = 0; i < 8; i++) {
            this.particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 5,
                vy: (Math.random() - 0.5) * 5,
                color, life: 25
            });
        }
    }
}

GameRegistry.register({
    id: 'AeroEngineering',
    title: 'Aero-Engineering',
    classic: 'Radical Aces',
    character: 'guha',
    mechanic: 'Top-down flight with 360-degree rotation',
    iconColor: '#1565C0',
    iconEmoji: '✈',
    scene: AeroEngineering
});
