/**
 * Game 9: Gravity Shift Run
 * ===========================
 * Classic: Gravity Guy | Character: Zack (Computer Science)
 * Mechanic: One-touch "Flip Gravity" logic with obstacle collision.
 */

class GravityShiftRun extends Phaser.Scene {
    constructor() {
        super({ key: 'GravityShiftRun' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.speed = 4;
        this.gravityDir = 1; // 1=down, -1=up
        this.playerVY = 0;
        this.playerX = width * 0.2;
        this.playerY = height / 2;
        this.isGrounded = false;
        this.scrollX = 0;
        this.gameOver = false;

        this.ceilingY = 40;
        this.floorY = height - 40;

        // Obstacles
        this.obstacles = [];
        this._generateObstacles(width);

        // Graphics
        this.bgGraphics = this.add.graphics();
        this.obstacleGraphics = this.add.graphics().setDepth(3);

        // Player
        const charKey = CharacterFactory.createTexture(this, 'zack', 2);
        this.playerSprite = this.add.image(this.playerX, this.playerY, charKey).setDepth(5);

        // Gravity indicator
        this.gravArrow = this.add.text(width - 40, 20, 'v', {
            fontSize: '20px', color: '#76FF03', fontFamily: 'sans-serif', fontStyle: 'bold'
        }).setDepth(10);

        // HUD
        this.add.text(10, 10, 'Zack - Gravity Shift', {
            fontSize: '13px', color: '#00E676', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.add.text(width / 2, height - 15, 'Tap / Space to FLIP GRAVITY', {
            fontSize: '12px', color: '#555588', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        // Input: single tap/press flips gravity
        this.input.on('pointerdown', () => this._flipGravity());
        this.input.keyboard.on('keydown-SPACE', () => this._flipGravity());
        this.input.keyboard.on('keydown-UP', () => this._flipGravity());
    }

    _flipGravity() {
        if (this.gameOver) return;
        this.gravityDir *= -1;
        this.playerVY = 0;
        this.gravArrow.setText(this.gravityDir > 0 ? 'v' : '^');
        this.gravArrow.setColor(this.gravityDir > 0 ? '#76FF03' : '#FF5252');
    }

    _generateObstacles(startX) {
        const { height } = this.scale;
        for (let i = 0; i < 30; i++) {
            const x = startX + 200 + i * Phaser.Math.Between(150, 250);
            const isTop = Math.random() > 0.5;
            const h = Phaser.Math.Between(60, 150);
            const gapSize = Phaser.Math.Between(100, 180);

            // Wall from top or bottom (or both for gap)
            if (Math.random() > 0.3) {
                // Gap obstacle
                this.obstacles.push({
                    x, y: this.ceilingY, w: 30,
                    h: (height - gapSize) / 2 - this.ceilingY + 40,
                    side: 'top'
                });
                this.obstacles.push({
                    x, y: this.ceilingY + (height - gapSize) / 2 + gapSize - 40, w: 30,
                    h: (height - gapSize) / 2 - 40 + this.ceilingY,
                    side: 'bottom'
                });
            } else {
                this.obstacles.push({
                    x,
                    y: isTop ? this.ceilingY : this.floorY - h,
                    w: 30,
                    h,
                    side: isTop ? 'top' : 'bottom'
                });
            }
        }
    }

    update() {
        if (this.gameOver) return;

        const { width, height } = this.scale;

        // Scroll
        this.scrollX += this.speed;
        this.speed = Math.min(10, this.speed + 0.001);
        this.score = Math.floor(this.scrollX / 10);
        Launcher.updateScore(this.score);

        // Gravity physics
        this.playerVY += this.gravityDir * 0.5;
        this.playerVY = Phaser.Math.Clamp(this.playerVY, -12, 12);
        this.playerY += this.playerVY;

        // Ceiling/floor collision
        if (this.playerY <= this.ceilingY + 20) {
            this.playerY = this.ceilingY + 20;
            if (this.gravityDir < 0) this.playerVY = 0;
        }
        if (this.playerY >= this.floorY - 20) {
            this.playerY = this.floorY - 20;
            if (this.gravityDir > 0) this.playerVY = 0;
        }

        this.playerSprite.setY(this.playerY);
        this.playerSprite.setFlipY(this.gravityDir < 0);

        // --- Draw background ---
        this.bgGraphics.clear();
        this.bgGraphics.fillGradientStyle(0x0a0a2e, 0x0a0a2e, 0x1a1a4e, 0x1a1a4e, 1);
        this.bgGraphics.fillRect(0, 0, width, height);

        // Ceiling and floor
        this.bgGraphics.fillStyle(0x333366, 1);
        this.bgGraphics.fillRect(0, 0, width, this.ceilingY);
        this.bgGraphics.fillRect(0, this.floorY, width, height - this.floorY);

        // Grid lines
        this.bgGraphics.lineStyle(1, 0x222255, 0.3);
        for (let x = -(this.scrollX % 50); x < width; x += 50) {
            this.bgGraphics.beginPath();
            this.bgGraphics.moveTo(x, this.ceilingY);
            this.bgGraphics.lineTo(x, this.floorY);
            this.bgGraphics.strokePath();
        }

        // --- Draw obstacles ---
        this.obstacleGraphics.clear();
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const o = this.obstacles[i];
            const screenX = o.x - this.scrollX;

            if (screenX < -50) {
                this.obstacles.splice(i, 1);
                continue;
            }
            if (screenX > width + 50) continue;

            this.obstacleGraphics.fillStyle(0x7E57C2, 0.9);
            this.obstacleGraphics.fillRect(screenX, o.y, o.w, o.h);
            this.obstacleGraphics.lineStyle(1, 0xB388FF, 0.6);
            this.obstacleGraphics.strokeRect(screenX, o.y, o.w, o.h);

            // Neon glow edge
            this.obstacleGraphics.fillStyle(0x00E676, 0.8);
            if (o.side === 'top') {
                this.obstacleGraphics.fillRect(screenX, o.y + o.h - 2, o.w, 2);
            } else {
                this.obstacleGraphics.fillRect(screenX, o.y, o.w, 2);
            }

            // Collision check
            if (screenX < this.playerX + 15 && screenX + o.w > this.playerX - 15) {
                if (this.playerY - 15 < o.y + o.h && this.playerY + 15 > o.y) {
                    this._onCrash();
                }
            }
        }

        // Generate more obstacles
        if (this.obstacles.length < 20) {
            const lastX = this.obstacles.length > 0
                ? Math.max(...this.obstacles.map(o => o.x))
                : this.scrollX + width;
            this._generateObstacles(lastX);
        }
    }

    _onCrash() {
        this.gameOver = true;
        this.add.text(this.scale.width / 2, this.scale.height / 2,
            `CRASH!\nDistance: ${this.score}m`, {
                fontSize: '28px', color: '#FF5252', align: 'center',
                fontFamily: 'sans-serif', fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(20);
    }
}

GameRegistry.register({
    id: 'GravityShiftRun',
    title: 'Gravity Shift Run',
    classic: 'Gravity Guy',
    character: 'zack',
    mechanic: 'One-touch flip-gravity with obstacle collision',
    iconColor: '#1A237E',
    iconEmoji: '🔄',
    scene: GravityShiftRun
});
