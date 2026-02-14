/**
 * Game 14: Color Lab Quest
 * ==========================
 * Classic: Red Beard | Character: Andrés (Chemistry)
 * Mechanic: Color-matching platforming (only cross platforms of matching color).
 */

class ColorLabQuest extends Phaser.Scene {
    constructor() {
        super({ key: 'ColorLabQuest' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.groundY = height - 40;
        this.playerVX = 0;
        this.playerVY = 0;
        this.isGrounded = false;
        this.playerX = 60;
        this.playerY = this.groundY - 20;
        this.currentColor = 'red'; // Player's active color
        this.colors = ['red', 'blue', 'green'];
        this.colorValues = { red: 0xE53935, blue: 0x2196F3, green: 0x4CAF50 };

        // Platforms with colors
        this.platforms = [];
        this._generatePlatforms(width, height);

        // Collectibles
        this.collectibles = [];
        this._generateCollectibles();

        // Goal
        this.goalX = width - 50;
        this.goalY = this.groundY - 80;

        // Graphics
        this.bgGraphics = this.add.graphics();
        this.platGraphics = this.add.graphics().setDepth(2);
        this.playerGraphics = this.add.graphics().setDepth(5);
        this.uiGraphics = this.add.graphics().setDepth(8);

        // HUD
        this.colorText = this.add.text(10, 10, 'Color: RED', {
            fontSize: '13px', color: '#E53935', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.add.text(width / 2, height - 12,
            'Arrows/WASD to move | 1/2/3 or Tap top to switch color', {
                fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
            }).setOrigin(0.5).setDepth(10);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({ w: 'W', a: 'A', d: 'D' });
        this.input.keyboard.on('keydown-ONE', () => this._setColor('red'));
        this.input.keyboard.on('keydown-TWO', () => this._setColor('blue'));
        this.input.keyboard.on('keydown-THREE', () => this._setColor('green'));

        // Touch: tap top portion to cycle colors
        this.input.on('pointerdown', (p) => {
            if (p.y < 60) {
                const idx = (this.colors.indexOf(this.currentColor) + 1) % this.colors.length;
                this._setColor(this.colors[idx]);
            }
        });
    }

    _setColor(color) {
        this.currentColor = color;
        const names = { red: 'RED', blue: 'BLUE', green: 'GREEN' };
        const hexStr = { red: '#E53935', blue: '#2196F3', green: '#4CAF50' };
        this.colorText.setText(`Color: ${names[color]}`);
        this.colorText.setColor(hexStr[color]);
    }

    _generatePlatforms(w, h) {
        const configs = [
            { x: 120, y: h - 120, pw: 80, color: 'red' },
            { x: 230, y: h - 180, pw: 70, color: 'blue' },
            { x: 350, y: h - 140, pw: 90, color: 'red' },
            { x: 440, y: h - 200, pw: 60, color: 'green' },
            { x: 530, y: h - 160, pw: 80, color: 'blue' },
            { x: 620, y: h - 220, pw: 70, color: 'red' },
            { x: 710, y: h - 120, pw: 80, color: 'green' },
            { x: 800, y: h - 180, pw: 100, color: 'blue' },
            { x: w - 80, y: h - 80, pw: 60, color: 'green' },
        ];

        configs.forEach(c => {
            this.platforms.push({
                x: c.x, y: c.y, w: c.pw, h: 12, color: c.color
            });
        });
    }

    _generateCollectibles() {
        this.platforms.forEach((p, i) => {
            if (i % 2 === 0) {
                this.collectibles.push({
                    x: p.x + p.w / 2, y: p.y - 20,
                    color: p.color, collected: false
                });
            }
        });
    }

    update() {
        const { width, height } = this.scale;

        // Movement
        let moveX = 0;
        if (this.cursors.left.isDown || this.wasd.a.isDown) moveX = -4;
        if (this.cursors.right.isDown || this.wasd.d.isDown) moveX = 4;
        if ((this.cursors.up.isDown || this.wasd.w.isDown) && this.isGrounded) {
            this.playerVY = -9;
            this.isGrounded = false;
        }

        this.playerX += moveX;
        this.playerX = Phaser.Math.Clamp(this.playerX, 10, width - 10);

        // Gravity
        this.playerVY += 0.45;
        this.playerY += this.playerVY;

        // Ground collision
        if (this.playerY >= this.groundY - 15) {
            this.playerY = this.groundY - 15;
            this.playerVY = 0;
            this.isGrounded = true;
        }

        // Platform collision (only matching color or neutral)
        this.isGrounded = this.playerY >= this.groundY - 16;
        this.platforms.forEach(p => {
            // Can only stand on matching color platforms
            if (p.color !== this.currentColor) return;

            if (this.playerVY >= 0 &&
                this.playerX > p.x - 8 && this.playerX < p.x + p.w + 8 &&
                this.playerY + 15 > p.y && this.playerY + 15 < p.y + p.h + 8) {
                this.playerY = p.y - 15;
                this.playerVY = 0;
                this.isGrounded = true;
            }
        });

        // Collect items
        this.collectibles.forEach(c => {
            if (c.collected) return;
            if (Math.abs(this.playerX - c.x) < 15 && Math.abs(this.playerY - c.y) < 15) {
                if (this.currentColor === c.color) {
                    c.collected = true;
                    this.score += 100;
                    Launcher.updateScore(this.score);
                }
            }
        });

        // Goal check
        if (Math.abs(this.playerX - this.goalX) < 25 && Math.abs(this.playerY - this.goalY) < 30) {
            this.score += 500;
            Launcher.updateScore(this.score);
            this.add.text(width / 2, height / 2, 'LEVEL COMPLETE!', {
                fontSize: '28px', color: '#FFD700',
                fontFamily: 'sans-serif', fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(20);
            this.scene.pause();
        }

        // Fall off
        if (this.playerY > height + 50) {
            this.playerX = 60;
            this.playerY = this.groundY - 20;
            this.playerVY = 0;
        }

        // --- Draw ---
        this.bgGraphics.clear();
        this.bgGraphics.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x2a2a4e, 0x2a2a4e, 1);
        this.bgGraphics.fillRect(0, 0, width, height);
        this.bgGraphics.fillStyle(0x333355, 1);
        this.bgGraphics.fillRect(0, this.groundY, width, height - this.groundY);

        // Platforms
        this.platGraphics.clear();
        this.platforms.forEach(p => {
            const isMatch = p.color === this.currentColor;
            this.platGraphics.fillStyle(this.colorValues[p.color], isMatch ? 1 : 0.25);
            this.platGraphics.fillRoundedRect(p.x, p.y, p.w, p.h, 3);
            if (isMatch) {
                this.platGraphics.lineStyle(1, 0xffffff, 0.4);
                this.platGraphics.strokeRoundedRect(p.x, p.y, p.w, p.h, 3);
            }
        });

        // Collectibles
        this.collectibles.forEach(c => {
            if (c.collected) return;
            this.platGraphics.fillStyle(this.colorValues[c.color], 0.8);
            const bob = Math.sin(Date.now() / 300 + c.x) * 3;
            this.platGraphics.fillCircle(c.x, c.y + bob, 8);
            this.platGraphics.fillStyle(0xffffff, 0.4);
            this.platGraphics.fillCircle(c.x - 2, c.y + bob - 2, 3);
        });

        // Goal
        this.platGraphics.fillStyle(0xFFD700, 0.8 + Math.sin(Date.now() / 200) * 0.2);
        this.platGraphics.fillCircle(this.goalX, this.goalY, 12);
        this.platGraphics.fillStyle(0xffffff, 0.5);
        this.platGraphics.fillCircle(this.goalX - 3, this.goalY - 3, 4);

        // Player
        this.playerGraphics.clear();
        this.playerGraphics.fillStyle(this.colorValues[this.currentColor], 1);
        this.playerGraphics.fillRoundedRect(this.playerX - 10, this.playerY - 15, 20, 30, 3);
        // Lab coat highlight
        this.playerGraphics.fillStyle(0xffffff, 0.3);
        this.playerGraphics.fillRect(this.playerX - 8, this.playerY - 5, 16, 3);
        // Eyes
        this.playerGraphics.fillStyle(0xffffff, 1);
        this.playerGraphics.fillCircle(this.playerX - 3, this.playerY - 9, 2.5);
        this.playerGraphics.fillCircle(this.playerX + 3, this.playerY - 9, 2.5);
        this.playerGraphics.fillStyle(0x111111, 1);
        this.playerGraphics.fillCircle(this.playerX - 3, this.playerY - 9, 1);
        this.playerGraphics.fillCircle(this.playerX + 3, this.playerY - 9, 1);
    }

    shutdown() {
        this.platforms = [];
        this.collectibles = [];
        this.colors = [];
    }
}

GameRegistry.register({
    id: 'ColorLabQuest',
    title: 'Color Lab Quest',
    classic: 'Red Beard',
    character: 'andres',
    mechanic: 'Color-matching platforming (matching color only)',
    iconColor: '#B71C1C',
    iconEmoji: '🎨',
    scene: ColorLabQuest
});
