/**
 * Game 2: STEM Project Volley
 * =============================
 * Classic: Raft Wars | Characters: Sofia vs Rex
 * Mechanic: Turn-based projectile arcs with destructible platforms.
 */

class STEMProjectVolley extends Phaser.Scene {
    constructor() {
        super({ key: 'STEMProjectVolley' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.currentTurn = 'player'; // 'player' or 'enemy'
        this.canShoot = true;
        this.gravity = 0.3;

        // --- Sky background ---
        const sky = this.add.graphics();
        sky.fillGradientStyle(0x87CEEB, 0x87CEEB, 0x4A90D9, 0x4A90D9, 1);
        sky.fillRect(0, 0, width, height);

        // --- Ground ---
        this.groundY = height * 0.75;
        const ground = this.add.graphics();
        ground.fillStyle(0x8B7355, 1);
        ground.fillRect(0, this.groundY, width, height - this.groundY);
        ground.fillStyle(0x6B8E23, 1);
        ground.fillRect(0, this.groundY - 5, width, 10);

        // --- Destructible platforms ---
        this.platforms = [];
        this._createPlatforms(width, height);

        // --- Player (Sofia) ---
        const sofiaKey = CharacterFactory.createTexture(this, 'sofia', 1.5);
        this.player = this.add.image(width * 0.15, this.groundY - 40, sofiaKey);
        this.add.text(width * 0.15, this.groundY - 75, 'Sofia', {
            fontSize: '11px', color: '#64B5F6', fontFamily: 'sans-serif'
        }).setOrigin(0.5);

        // --- Enemy (Rex) ---
        const rexKey = CharacterFactory.createTexture(this, 'rex', 1.5);
        this.enemy = this.add.image(width * 0.85, this.groundY - 40, rexKey);
        this.enemyHP = 3;
        this.add.text(width * 0.85, this.groundY - 75, 'Rex', {
            fontSize: '11px', color: '#7E57C2', fontFamily: 'sans-serif'
        }).setOrigin(0.5);

        // --- HP display ---
        this.playerHPText = this.add.text(width * 0.15, 20, 'HP: 3', {
            fontSize: '14px', color: '#64B5F6', fontFamily: 'sans-serif'
        }).setOrigin(0.5);
        this.enemyHPText = this.add.text(width * 0.85, 20, 'HP: 3', {
            fontSize: '14px', color: '#7E57C2', fontFamily: 'sans-serif'
        }).setOrigin(0.5);
        this.playerHP = 3;

        // --- Aim controls ---
        this.aimAngle = -Math.PI / 4;
        this.aimPower = 8;
        this.aimGraphics = this.add.graphics();
        this.projectiles = [];

        // --- Turn indicator ---
        this.turnText = this.add.text(width / 2, 20, "Sofia's Turn - Drag to Aim!", {
            fontSize: '15px', color: '#ffffff', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        // --- Input ---
        this.input.on('pointerdown', this._onAimStart, this);
        this.input.on('pointermove', this._onAimMove, this);
        this.input.on('pointerup', this._onAimRelease, this);
        this.isDragging = false;
    }

    _createPlatforms(w, h) {
        const platGraphics = this.add.graphics();
        const positions = [
            { x: w * 0.4, y: this.groundY - 30, pw: 60, ph: 15 },
            { x: w * 0.5, y: this.groundY - 60, pw: 50, ph: 15 },
            { x: w * 0.6, y: this.groundY - 30, pw: 60, ph: 15 },
            { x: w * 0.5, y: this.groundY - 100, pw: 40, ph: 12 },
        ];

        positions.forEach(p => {
            platGraphics.fillStyle(0x795548, 1);
            platGraphics.fillRect(p.x - p.pw / 2, p.y - p.ph / 2, p.pw, p.ph);
            platGraphics.lineStyle(1, 0x5D4037, 1);
            platGraphics.strokeRect(p.x - p.pw / 2, p.y - p.ph / 2, p.pw, p.ph);

            this.platforms.push({
                x: p.x, y: p.y, w: p.pw, h: p.ph,
                hp: 2, graphics: platGraphics, active: true
            });
        });
    }

    _onAimStart(pointer) {
        if (this.currentTurn !== 'player' || !this.canShoot) return;
        this.isDragging = true;
        this.dragOrigin = { x: this.player.x, y: this.player.y - 10 };
    }

    _onAimMove(pointer) {
        if (!this.isDragging) return;
        const dx = pointer.x - this.dragOrigin.x;
        const dy = pointer.y - this.dragOrigin.y;
        this.aimAngle = Math.atan2(dy, dx);
        this.aimPower = Math.min(Math.sqrt(dx * dx + dy * dy) / 20, 16);

        // Draw aim trajectory preview
        this.aimGraphics.clear();
        this.aimGraphics.lineStyle(2, 0xffffff, 0.5);
        this.aimGraphics.beginPath();

        let px = this.dragOrigin.x;
        let py = this.dragOrigin.y;
        const vx = Math.cos(this.aimAngle) * this.aimPower * 0.6;
        const vy = Math.sin(this.aimAngle) * this.aimPower * 0.6;

        this.aimGraphics.moveTo(px, py);
        for (let t = 0; t < 30; t++) {
            px += vx;
            py += vy + this.gravity * t;
            this.aimGraphics.lineTo(px, py);
            if (py > this.groundY) break;
        }
        this.aimGraphics.strokePath();
    }

    _onAimRelease() {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.aimGraphics.clear();

        if (this.aimPower > 1) {
            this._fireProjectile(
                this.dragOrigin.x, this.dragOrigin.y,
                Math.cos(this.aimAngle) * this.aimPower,
                Math.sin(this.aimAngle) * this.aimPower,
                'player'
            );
            this.canShoot = false;
        }
    }

    _fireProjectile(x, y, vx, vy, owner) {
        const g = this.add.graphics();
        g.fillStyle(owner === 'player' ? 0x64B5F6 : 0x7E57C2, 1);
        g.fillCircle(0, 0, 6);
        g.setPosition(x, y);

        this.projectiles.push({
            graphics: g, x, y, vx, vy, owner, active: true
        });
    }

    _enemyTurn() {
        this.turnText.setText("Rex's Turn...");
        this.time.delayedCall(800, () => {
            // Simple AI: aim toward player with some variance
            const dx = this.player.x - this.enemy.x;
            const dy = (this.player.y - 20) - this.enemy.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const power = Math.min(dist / 40, 14);
            const angle = Math.atan2(dy - dist * 0.3, dx) + (Math.random() - 0.5) * 0.3;

            this._fireProjectile(
                this.enemy.x, this.enemy.y - 10,
                Math.cos(angle) * power,
                Math.sin(angle) * power,
                'enemy'
            );
        });
    }

    update() {
        // Update projectiles
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            if (!p.active) continue;

            p.vy += this.gravity;
            p.x += p.vx;
            p.y += p.vy;
            p.graphics.setPosition(p.x, p.y);

            // Hit ground
            if (p.y > this.groundY) {
                p.active = false;
                p.graphics.destroy();
                this._endTurn(p.owner);
                continue;
            }

            // Hit enemy (player's shot)
            if (p.owner === 'player' && this.enemy) {
                const edx = p.x - this.enemy.x;
                const edy = p.y - this.enemy.y;
                if (Math.sqrt(edx * edx + edy * edy) < 25) {
                    this.enemyHP--;
                    this.enemyHPText.setText(`HP: ${this.enemyHP}`);
                    this.score += 200;
                    Launcher.updateScore(this.score);
                    p.active = false;
                    p.graphics.destroy();
                    if (this.enemyHP <= 0) {
                        this._victory();
                    } else {
                        this._endTurn(p.owner);
                    }
                    continue;
                }
            }

            // Hit player (enemy's shot)
            if (p.owner === 'enemy' && this.player) {
                const pdx = p.x - this.player.x;
                const pdy = p.y - this.player.y;
                if (Math.sqrt(pdx * pdx + pdy * pdy) < 25) {
                    this.playerHP--;
                    this.playerHPText.setText(`HP: ${this.playerHP}`);
                    p.active = false;
                    p.graphics.destroy();
                    if (this.playerHP <= 0) {
                        this._defeat();
                    } else {
                        this._endTurn(p.owner);
                    }
                    continue;
                }
            }

            // Hit platforms
            this.platforms.forEach(plat => {
                if (!plat.active) return;
                if (p.x > plat.x - plat.w / 2 && p.x < plat.x + plat.w / 2 &&
                    p.y > plat.y - plat.h / 2 && p.y < plat.y + plat.h / 2) {
                    plat.hp--;
                    if (plat.hp <= 0) {
                        plat.active = false;
                        // Visual: redraw platforms
                    }
                    p.active = false;
                    p.graphics.destroy();
                    this._endTurn(p.owner);
                }
            });

            // Off screen
            if (p.x < -50 || p.x > this.scale.width + 50) {
                p.active = false;
                p.graphics.destroy();
                this._endTurn(p.owner);
            }
        }
    }

    _endTurn(lastOwner) {
        this.time.delayedCall(500, () => {
            if (lastOwner === 'player') {
                this.currentTurn = 'enemy';
                this._enemyTurn();
            } else {
                this.currentTurn = 'player';
                this.canShoot = true;
                this.turnText.setText("Sofia's Turn - Drag to Aim!");
            }
        });
    }

    _victory() {
        this.add.text(this.scale.width / 2, this.scale.height / 2,
            'SOFIA WINS!', {
                fontSize: '32px', color: '#64B5F6',
                fontFamily: 'sans-serif', fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(20);
    }

    _defeat() {
        this.add.text(this.scale.width / 2, this.scale.height / 2,
            'REX WINS... Try Again!', {
                fontSize: '28px', color: '#7E57C2',
                fontFamily: 'sans-serif', fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(20);
    }
}

GameRegistry.register({
    id: 'STEMProjectVolley',
    title: 'STEM Project Volley',
    classic: 'Raft Wars',
    character: 'sofia_vs_rex',
    mechanic: 'Turn-based projectile arcs with destructible platforms',
    iconColor: '#5D4037',
    iconEmoji: '💣',
    scene: STEMProjectVolley
});
