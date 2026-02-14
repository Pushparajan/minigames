/**
 * Game 1: Physics Master Billiards
 * ==================================
 * Classic: 8 Ball Pool | Character: Guha (Physics)
 * Mechanic: Matter.js physics with power-drag aiming logic.
 *
 * The player drags from the cue ball to set direction and power,
 * then releases to shoot. Matter.js handles all collision physics.
 */

class PhysicsMasterBilliards extends Phaser.Scene {
    constructor() {
        super({ key: 'PhysicsMasterBilliards' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.isDragging = false;
        this.shotPower = 0;
        this.maxPower = 18;
        this.ballRadius = 14;
        this.pocketed = 0;

        // --- Table Setup ---
        this._createTable(width, height);

        // --- Balls ---
        this._createBalls(width, height);

        // --- Cue Ball Aiming ---
        this.aimLine = this.add.graphics();
        this.powerBar = this.add.graphics();

        // --- Input: Drag to aim and shoot ---
        this.input.on('pointerdown', this._onPointerDown, this);
        this.input.on('pointermove', this._onPointerMove, this);
        this.input.on('pointerup', this._onPointerUp, this);

        // --- Character badge ---
        const charKey = CharacterFactory.createTexture(this, 'guha', 1.5);
        this.add.image(50, 30, charKey).setScrollFactor(0).setDepth(10);
        this.add.text(80, 20, 'Guha - Physics Master', {
            fontSize: '13px', color: '#E53935', fontFamily: 'sans-serif'
        }).setDepth(10);

        // --- Instructions ---
        this.instructionText = this.add.text(width / 2, height - 25,
            'Drag from cue ball to aim & shoot!', {
                fontSize: '13px', color: '#aaaacc', fontFamily: 'sans-serif'
            }).setOrigin(0.5).setDepth(10);

        // --- Pocket collision detection ---
        this.matter.world.on('collisionstart', this._onCollision, this);
    }

    /**
     * Create the billiards table with walls and pockets.
     */
    _createTable(w, h) {
        const tableW = Math.min(w * 0.9, 800);
        const tableH = tableW * 0.5;
        const tx = (w - tableW) / 2;
        const ty = (h - tableH) / 2;

        this.tableX = tx;
        this.tableY = ty;
        this.tableW = tableW;
        this.tableH = tableH;

        // Table felt
        const g = this.add.graphics();
        g.fillStyle(0x0d6b3b, 1);
        g.fillRoundedRect(tx, ty, tableW, tableH, 8);

        // Rail/border
        g.lineStyle(8, 0x5d3a1a, 1);
        g.strokeRoundedRect(tx, ty, tableW, tableH, 8);

        // Walls (Matter.js static bodies)
        const wallThick = 20;
        const opts = { isStatic: true, restitution: 0.7, friction: 0.05, label: 'wall' };
        const pocketR = this.ballRadius * 1.6;

        // Top wall (split for center pocket)
        this.matter.add.rectangle(tx + tableW * 0.25, ty - wallThick / 2, tableW * 0.42, wallThick, opts);
        this.matter.add.rectangle(tx + tableW * 0.75, ty - wallThick / 2, tableW * 0.42, wallThick, opts);
        // Bottom wall (split)
        this.matter.add.rectangle(tx + tableW * 0.25, ty + tableH + wallThick / 2, tableW * 0.42, wallThick, opts);
        this.matter.add.rectangle(tx + tableW * 0.75, ty + tableH + wallThick / 2, tableW * 0.42, wallThick, opts);
        // Left wall
        this.matter.add.rectangle(tx - wallThick / 2, ty + tableH / 2, wallThick, tableH * 0.85, opts);
        // Right wall
        this.matter.add.rectangle(tx + tableW + wallThick / 2, ty + tableH / 2, wallThick, tableH * 0.85, opts);

        // Pockets (sensors)
        this.pockets = [];
        const pocketPositions = [
            { x: tx + pocketR * 0.3, y: ty + pocketR * 0.3 },               // Top-left
            { x: tx + tableW / 2, y: ty - pocketR * 0.2 },                   // Top-center
            { x: tx + tableW - pocketR * 0.3, y: ty + pocketR * 0.3 },       // Top-right
            { x: tx + pocketR * 0.3, y: ty + tableH - pocketR * 0.3 },       // Bottom-left
            { x: tx + tableW / 2, y: ty + tableH + pocketR * 0.2 },           // Bottom-center
            { x: tx + tableW - pocketR * 0.3, y: ty + tableH - pocketR * 0.3 } // Bottom-right
        ];

        pocketPositions.forEach(pos => {
            // Visual pocket
            g.fillStyle(0x111111, 1);
            g.fillCircle(pos.x, pos.y, pocketR);

            // Sensor body
            const pocket = this.matter.add.circle(pos.x, pos.y, pocketR, {
                isStatic: true,
                isSensor: true,
                label: 'pocket'
            });
            this.pockets.push(pocket);
        });
    }

    /**
     * Create cue ball and target balls in triangle formation.
     */
    _createBalls(w, h) {
        const r = this.ballRadius;
        const cx = this.tableX + this.tableW * 0.3;
        const cy = this.tableY + this.tableH / 2;

        // Cue ball (white)
        const cueKey = this._makeCircleTexture('cue_ball', r, 0xffffff, 0xcccccc);
        this.cueBall = this.matter.add.image(cx, cy, cueKey, null, {
            circleRadius: r,
            restitution: 0.9,
            friction: 0.02,
            frictionAir: 0.015,
            density: 0.004,
            label: 'cueBall'
        });

        // Target balls in triangle
        const startX = this.tableX + this.tableW * 0.68;
        const startY = this.tableY + this.tableH / 2;
        const colors = [
            0xE53935, 0x1E88E5, 0x43A047, 0xFF8F00, 0x8E24AA,
            0xD81B60, 0x00897B, 0x6D4C41, 0xFDD835, 0x3949AB,
            0xF4511E, 0x00ACC1, 0x7CB342, 0xC62828, 0x5E35B1
        ];

        this.targetBalls = [];
        let ballIndex = 0;
        const spacing = r * 2.15;

        for (let row = 0; row < 5; row++) {
            for (let col = 0; col <= row; col++) {
                if (ballIndex >= 15) break;
                const bx = startX + row * spacing * 0.866;
                const by = startY + (col - row / 2) * spacing;
                const color = colors[ballIndex];
                const key = this._makeCircleTexture(`ball_${ballIndex}`, r, color, 0xffffff);

                const ball = this.matter.add.image(bx, by, key, null, {
                    circleRadius: r,
                    restitution: 0.9,
                    friction: 0.02,
                    frictionAir: 0.018,
                    density: 0.004,
                    label: `ball_${ballIndex}`
                });
                ball.ballIndex = ballIndex;
                this.targetBalls.push(ball);
                ballIndex++;
            }
        }
    }

    /**
     * Generate a circle texture programmatically.
     */
    _makeCircleTexture(key, radius, fillColor, highlightColor) {
        if (this.textures.exists(key)) return key;
        const d = radius * 2;
        const g = this.add.graphics();
        g.fillStyle(fillColor, 1);
        g.fillCircle(radius, radius, radius);
        g.fillStyle(highlightColor, 0.3);
        g.fillCircle(radius * 0.7, radius * 0.65, radius * 0.35);
        g.generateTexture(key, d, d);
        g.destroy();
        return key;
    }

    // --- Input Handlers ---

    _onPointerDown(pointer) {
        if (!this.cueBall || !this.cueBall.body) return;
        const dx = pointer.x - this.cueBall.x;
        const dy = pointer.y - this.cueBall.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Only start aiming if clicking near the cue ball
        if (dist < this.ballRadius * 4) {
            this.isDragging = true;
            this.dragStart = { x: pointer.x, y: pointer.y };
        }
    }

    _onPointerMove(pointer) {
        if (!this.isDragging) return;

        this.aimLine.clear();
        this.powerBar.clear();

        const dx = this.dragStart.x - pointer.x;
        const dy = this.dragStart.y - pointer.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        this.shotPower = Math.min(dist / 15, this.maxPower);

        // Aim line (from cue ball in shot direction)
        const angle = Math.atan2(dy, dx);
        const lineLen = Math.min(dist * 0.8, 200);

        this.aimLine.lineStyle(2, 0xffffff, 0.6);
        this.aimLine.beginPath();
        this.aimLine.moveTo(this.cueBall.x, this.cueBall.y);
        this.aimLine.lineTo(
            this.cueBall.x + Math.cos(angle) * lineLen,
            this.cueBall.y + Math.sin(angle) * lineLen
        );
        this.aimLine.strokePath();

        // Dotted extension
        this.aimLine.lineStyle(1, 0xffffff, 0.25);
        for (let i = 0; i < 8; i++) {
            const startD = lineLen + i * 12;
            const endD = startD + 6;
            this.aimLine.beginPath();
            this.aimLine.moveTo(
                this.cueBall.x + Math.cos(angle) * startD,
                this.cueBall.y + Math.sin(angle) * startD
            );
            this.aimLine.lineTo(
                this.cueBall.x + Math.cos(angle) * endD,
                this.cueBall.y + Math.sin(angle) * endD
            );
            this.aimLine.strokePath();
        }

        // Power bar
        const barX = this.tableX + this.tableW + 20;
        const barY = this.tableY;
        const barW = 12;
        const barH = this.tableH;
        const fillRatio = this.shotPower / this.maxPower;

        this.powerBar.fillStyle(0x333333, 0.8);
        this.powerBar.fillRoundedRect(barX, barY, barW, barH, 4);
        const pColor = fillRatio < 0.5 ? 0x43A047 : fillRatio < 0.8 ? 0xFF8F00 : 0xE53935;
        this.powerBar.fillStyle(pColor, 1);
        this.powerBar.fillRoundedRect(barX, barY + barH * (1 - fillRatio), barW, barH * fillRatio, 4);
    }

    _onPointerUp() {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.aimLine.clear();
        this.powerBar.clear();

        if (this.shotPower > 0.5 && this.cueBall && this.cueBall.body) {
            const dx = this.dragStart.x - this.input.activePointer.x;
            const dy = this.dragStart.y - this.input.activePointer.y;
            const angle = Math.atan2(dy, dx);

            const forceX = Math.cos(angle) * this.shotPower * 0.0008;
            const forceY = Math.sin(angle) * this.shotPower * 0.0008;

            this.cueBall.setVelocity(0, 0);
            this.matter.body.applyForce(this.cueBall.body, this.cueBall.body.position, {
                x: forceX,
                y: forceY
            });
        }

        this.shotPower = 0;
    }

    /**
     * Handle pocket collisions — remove pocketed balls.
     */
    _onCollision(event) {
        event.pairs.forEach(pair => {
            const labels = [pair.bodyA.label, pair.bodyB.label];
            if (!labels.includes('pocket')) return;

            const otherBody = pair.bodyA.label === 'pocket' ? pair.bodyB : pair.bodyA;

            if (otherBody.label === 'cueBall') {
                // Scratch — reset cue ball
                this.time.delayedCall(300, () => {
                    if (this.cueBall && this.cueBall.body) {
                        this.matter.body.setPosition(this.cueBall.body, {
                            x: this.tableX + this.tableW * 0.3,
                            y: this.tableY + this.tableH / 2
                        });
                        this.matter.body.setVelocity(this.cueBall.body, { x: 0, y: 0 });
                    }
                });
            } else if (otherBody.label.startsWith('ball_')) {
                // Pocket a target ball
                const ball = this.targetBalls.find(b => b.body === otherBody);
                if (ball) {
                    this.pocketed++;
                    this.score += 100;
                    Launcher.updateScore(this.score);

                    // Remove ball
                    this.matter.world.remove(ball.body);
                    ball.setVisible(false);
                    ball.body = null;

                    // Win condition
                    if (this.pocketed >= 15) {
                        this.add.text(this.scale.width / 2, this.scale.height / 2,
                            'ALL POCKETED! YOU WIN!', {
                                fontSize: '28px', color: '#FFD700',
                                fontFamily: 'sans-serif', fontStyle: 'bold'
                            }).setOrigin(0.5).setDepth(20);
                    }
                }
            }
        });
    }

    update() {
        // Ensure balls stay within table bounds (safety net)
        const allBalls = [this.cueBall, ...this.targetBalls].filter(b => b && b.body);
        const margin = this.ballRadius;
        const minX = this.tableX + margin;
        const maxX = this.tableX + this.tableW - margin;
        const minY = this.tableY + margin;
        const maxY = this.tableY + this.tableH - margin;

        allBalls.forEach(ball => {
            if (ball.x < minX - 30 || ball.x > maxX + 30 ||
                ball.y < minY - 30 || ball.y > maxY + 30) {
                // Ball escaped — clamp it back
                const cx = Phaser.Math.Clamp(ball.x, minX, maxX);
                const cy = Phaser.Math.Clamp(ball.y, minY, maxY);
                this.matter.body.setPosition(ball.body, { x: cx, y: cy });
                this.matter.body.setVelocity(ball.body, { x: 0, y: 0 });
            }
        });
    }
}

// Register the game
GameRegistry.register({
    id: 'PhysicsMasterBilliards',
    title: 'Physics Master Billiards',
    classic: '8 Ball Pool',
    character: 'guha',
    mechanic: 'Matter.js physics with power-drag aiming logic',
    iconColor: '#0d6b3b',
    iconEmoji: '🎱',
    scene: PhysicsMasterBilliards
});
