/**
 * Game 24: Parkour Lab
 * =====================
 * Classic: Free Running | Character: Zack (Computer Science)
 * Mechanic: Momentum-based timing jumps with "stumble" frames.
 */

class ParkourLab extends Phaser.Scene {
    constructor() {
        super({ key: 'ParkourLab' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.groundY = height - 50;
        this.scrollX = 0;
        this.speed = 4;
        this.maxSpeed = 8;
        this.momentum = 1;
        this.gameOver = false;
        this.isJumping = false;
        this.isSliding = false;
        this.stumbling = false;
        this.stumbleTimer = 0;
        this.playerVY = 0;
        this.playerY = this.groundY - 30;

        // Generate obstacles and platforms
        this.obstacles = [];
        this.platforms = [];
        this._generateCourse(width);

        // Graphics
        this.bgGraphics = this.add.graphics();
        this.courseGraphics = this.add.graphics().setDepth(2);
        this.playerGraphics = this.add.graphics().setDepth(5);

        // HUD
        const charKey = CharacterFactory.createTexture(this, 'zack', 1);
        this.add.image(25, 15, charKey).setDepth(10);
        this.add.text(50, 8, 'Zack - Parkour Lab', {
            fontSize: '11px', color: '#00E676', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.momentumText = this.add.text(width / 2, 10, 'Momentum: MAX', {
            fontSize: '13px', color: '#76FF03', fontFamily: 'sans-serif'
        }).setOrigin(0.5, 0).setDepth(10);

        this.add.text(width / 2, height - 12,
            'UP/Space = Jump at right time | DOWN = Slide | Timing is key!', {
                fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
            }).setOrigin(0.5).setDepth(10);

        // Input
        this.input.keyboard.on('keydown-SPACE', () => this._jump());
        this.input.keyboard.on('keydown-UP', () => this._jump());
        this.input.keyboard.on('keydown-W', () => this._jump());
        this.input.keyboard.on('keydown-DOWN', () => this._slide());
        this.input.keyboard.on('keydown-S', () => this._slide());

        this.input.on('pointerdown', (p) => {
            if (p.y < height / 2) this._jump();
            else this._slide();
        });
    }

    _generateCourse(startX) {
        let x = startX + 300;
        for (let i = 0; i < 50; i++) {
            const type = Phaser.Math.Between(0, 3);
            const gap = Phaser.Math.Between(150, 300);

            switch (type) {
                case 0: // Low wall (jump over)
                    this.obstacles.push({
                        x, type: 'wall',
                        w: 20, h: 40,
                        y: this.groundY - 40
                    });
                    break;
                case 1: // High bar (slide under)
                    this.obstacles.push({
                        x, type: 'bar',
                        w: 40, h: 12,
                        y: this.groundY - 55
                    });
                    break;
                case 2: // Gap (must jump)
                    this.obstacles.push({
                        x, type: 'gap',
                        w: 60, h: 0,
                        y: this.groundY
                    });
                    break;
                case 3: // Platform (jump onto)
                    this.platforms.push({
                        x, w: 80,
                        y: this.groundY - Phaser.Math.Between(50, 100)
                    });
                    break;
            }
            x += gap;
        }
    }

    _jump() {
        if (this.gameOver || this.isJumping || this.stumbling) return;
        this.isJumping = true;
        this.isSliding = false;
        this.playerVY = -10 - this.momentum * 2;

        // Perfect timing bonus (near an obstacle)
        const nearObs = this.obstacles.find(o => {
            const screenX = o.x - this.scrollX;
            return screenX > 80 && screenX < 160;
        });
        if (nearObs) {
            this.momentum = Math.min(3, this.momentum + 0.3);
            this.score += 50;
            Launcher.updateScore(this.score);
        }
    }

    _slide() {
        if (this.gameOver || this.isJumping || this.stumbling) return;
        this.isSliding = true;
        this.time.delayedCall(500, () => { this.isSliding = false; });
    }

    _stumble() {
        this.stumbling = true;
        this.stumbleTimer = 40;
        this.momentum = Math.max(0.5, this.momentum - 0.5);
        this.speed = Math.max(2, this.speed - 1.5);
    }

    update() {
        if (this.gameOver) return;
        const { width, height } = this.scale;

        // Auto-run
        this.speed = Math.min(this.maxSpeed, this.speed + 0.003);
        this.scrollX += this.speed;
        this.score = Math.floor(this.scrollX / 5);
        Launcher.updateScore(this.score);

        // Stumble recovery
        if (this.stumbling) {
            this.stumbleTimer--;
            if (this.stumbleTimer <= 0) this.stumbling = false;
        }

        // Gravity
        if (this.isJumping) {
            this.playerVY += 0.55;
            this.playerY += this.playerVY;

            // Check platform landing
            let landed = false;
            this.platforms.forEach(p => {
                const sx = p.x - this.scrollX;
                if (sx > 50 && sx < 50 + p.w &&
                    this.playerVY > 0 &&
                    this.playerY + 25 > p.y && this.playerY + 25 < p.y + 15) {
                    this.playerY = p.y - 25;
                    this.playerVY = 0;
                    this.isJumping = false;
                    landed = true;
                    this.momentum = Math.min(3, this.momentum + 0.2);
                }
            });

            if (!landed && this.playerY >= this.groundY - 30) {
                this.playerY = this.groundY - 30;
                this.playerVY = 0;
                this.isJumping = false;
            }
        }

        // Momentum display
        this.momentumText.setText(`Momentum: ${this.momentum >= 2.5 ? 'MAX' : Math.round(this.momentum * 100) + '%'}`);
        this.momentumText.setColor(this.momentum > 2 ? '#76FF03' : this.momentum > 1 ? '#FFD54F' : '#FF5252');

        // --- Draw background ---
        this.bgGraphics.clear();
        this.bgGraphics.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x2a2a4e, 0x2a2a4e, 1);
        this.bgGraphics.fillRect(0, 0, width, height);

        // Background buildings
        this.bgGraphics.fillStyle(0x222244, 0.6);
        for (let x = -(this.scrollX * 0.2 % 100); x < width; x += 100) {
            const bh = 60 + (x * 7 % 80);
            this.bgGraphics.fillRect(x, this.groundY - bh, 50, bh);
        }

        // Ground
        this.bgGraphics.fillStyle(0x333355, 1);
        this.bgGraphics.fillRect(0, this.groundY, width, height - this.groundY);
        // Grid lines on ground
        this.bgGraphics.lineStyle(1, 0x444466, 0.4);
        for (let x = -(this.scrollX % 30); x < width; x += 30) {
            this.bgGraphics.beginPath();
            this.bgGraphics.moveTo(x, this.groundY);
            this.bgGraphics.lineTo(x, height);
            this.bgGraphics.strokePath();
        }

        // --- Draw course ---
        this.courseGraphics.clear();

        // Obstacles
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const o = this.obstacles[i];
            const sx = o.x - this.scrollX;

            if (sx < -100) { this.obstacles.splice(i, 1); continue; }
            if (sx > width + 100) continue;

            if (o.type === 'wall') {
                this.courseGraphics.fillStyle(0x7E57C2, 1);
                this.courseGraphics.fillRect(sx, o.y, o.w, o.h);
                this.courseGraphics.lineStyle(1, 0xB388FF, 0.6);
                this.courseGraphics.strokeRect(sx, o.y, o.w, o.h);

                // Collision
                if (sx > 50 && sx < 90 && !this.isJumping && !this.stumbling) {
                    this._stumble();
                }
            } else if (o.type === 'bar') {
                this.courseGraphics.fillStyle(0xFF9800, 1);
                this.courseGraphics.fillRect(sx, o.y, o.w, o.h);

                // Collision (hit if not sliding)
                if (sx > 50 && sx < 90 && !this.isSliding && !this.isJumping && !this.stumbling) {
                    this._stumble();
                }
            } else if (o.type === 'gap') {
                this.courseGraphics.fillStyle(0x0a0a1e, 1);
                this.courseGraphics.fillRect(sx, o.y, o.w, height - o.y);

                // Fall into gap
                if (sx > 40 && sx < 40 + o.w && !this.isJumping) {
                    this.gameOver = true;
                    this.add.text(width / 2, height / 2,
                        `FELL!\nDistance: ${this.score}m`, {
                            fontSize: '24px', color: '#FF5252', align: 'center',
                            fontFamily: 'sans-serif', fontStyle: 'bold'
                        }).setOrigin(0.5).setDepth(20);
                }
            }
        }

        // Platforms
        this.platforms.forEach(p => {
            const sx = p.x - this.scrollX;
            if (sx < -100 || sx > width + 100) return;
            this.courseGraphics.fillStyle(0x546E7A, 1);
            this.courseGraphics.fillRect(sx, p.y, p.w, 8);
            this.courseGraphics.fillStyle(0x76FF03, 0.6);
            this.courseGraphics.fillRect(sx, p.y, p.w, 2);
        });

        // --- Draw player ---
        const px = 70;
        const py = this.playerY;
        this.playerGraphics.clear();

        if (this.stumbling) {
            // Stumble animation (tilted, red flash)
            this.playerGraphics.fillStyle(0xFF5252, 0.8);
            this.playerGraphics.fillRoundedRect(px - 12, py - 8, 24, 20, 3);
        } else if (this.isSliding) {
            // Slide (low profile)
            this.playerGraphics.fillStyle(0x424242, 1);
            this.playerGraphics.fillRoundedRect(px - 14, py + 10, 28, 12, 3);
            this.playerGraphics.fillStyle(0x00E676, 0.8);
            this.playerGraphics.fillRect(px - 12, py + 14, 24, 3);
        } else {
            // Normal running
            this.playerGraphics.fillStyle(0x424242, 1);
            this.playerGraphics.fillRoundedRect(px - 10, py - 15, 20, 30, 3);
            // Pixel pattern
            this.playerGraphics.fillStyle(0x00E676, 0.8);
            this.playerGraphics.fillRect(px - 8, py - 3, 16, 3);
            // Eyes
            this.playerGraphics.fillStyle(0x76FF03, 1);
            this.playerGraphics.fillCircle(px - 3, py - 8, 2);
            this.playerGraphics.fillCircle(px + 3, py - 8, 2);
            // Running legs animation
            const legPhase = Math.sin(this.scrollX * 0.3);
            this.playerGraphics.fillStyle(0x333333, 1);
            this.playerGraphics.fillRect(px - 4 + legPhase * 4, py + 14, 4, 8);
            this.playerGraphics.fillRect(px + 0 - legPhase * 4, py + 14, 4, 8);
        }
    }
}

GameRegistry.register({
    id: 'ParkourLab',
    title: 'Parkour Lab',
    classic: 'Free Running',
    character: 'zack',
    mechanic: 'Momentum-based timing jumps with stumble frames',
    iconColor: '#212121',
    iconEmoji: '🏃',
    scene: ParkourLab
});
