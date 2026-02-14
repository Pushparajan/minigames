/**
 * Game 10: Demo Day
 * ===================
 * Classic: Rubble Trouble | Character: Sofia (Engineering)
 * Mechanic: Precision explosives placement and structural collapse physics.
 */

class DemoDay extends Phaser.Scene {
    constructor() {
        super({ key: 'DemoDay' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.explosivesLeft = 5;
        this.blocks = [];
        this.debris = [];
        this.groundY = height - 50;
        this.gravity = 0.4;

        // Background
        const bg = this.add.graphics();
        bg.fillGradientStyle(0x87CEEB, 0x87CEEB, 0xB3E5FC, 0xB3E5FC, 1);
        bg.fillRect(0, 0, width, height);
        bg.fillStyle(0x6B8E23, 1);
        bg.fillRect(0, this.groundY, width, height - this.groundY);

        // Build a structure to demolish
        this._buildStructure(width, height);

        // Target zone (rubble must clear this area)
        this.targetZone = {
            x: width * 0.3, y: this.groundY - 10,
            w: width * 0.4, h: 10
        };

        bg.fillStyle(0xFFD54F, 0.3);
        bg.fillRect(this.targetZone.x, this.targetZone.y,
            this.targetZone.w, this.targetZone.h);

        // Graphics
        this.blockGraphics = this.add.graphics().setDepth(3);
        this.debrisGraphics = this.add.graphics().setDepth(2);
        this.uiGraphics = this.add.graphics().setDepth(8);

        // Character
        const charKey = CharacterFactory.createTexture(this, 'sofia', 1.5);
        this.add.image(40, 25, charKey).setDepth(10);
        this.add.text(70, 15, 'Sofia - Demo Day', {
            fontSize: '13px', color: '#64B5F6', fontFamily: 'sans-serif'
        }).setDepth(10);

        // HUD
        this.expText = this.add.text(width - 10, 10, `Explosives: ${this.explosivesLeft}`, {
            fontSize: '13px', color: '#FF5252', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);

        this.add.text(width / 2, height - 15, 'Click on structure to place explosive!', {
            fontSize: '11px', color: '#5D4037', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        // Input
        this.input.on('pointerdown', this._placeExplosive, this);

        this._drawBlocks();
    }

    _buildStructure(w, h) {
        const blockW = 40;
        const blockH = 20;
        const startX = w * 0.35;
        const startY = this.groundY;

        // Simple building structure
        const layout = [
            // Row 0 (bottom) - foundation
            [0, 1, 2, 3, 4, 5],
            // Row 1
            [0, 1, 2, 3, 4, 5],
            // Row 2
            [1, 2, 3, 4],
            // Row 3
            [1, 2, 3, 4],
            // Row 4
            [2, 3],
            // Row 5 (top)
            [2, 3],
        ];

        layout.forEach((row, rowIdx) => {
            row.forEach(col => {
                this.blocks.push({
                    x: startX + col * blockW,
                    y: startY - (rowIdx + 1) * blockH,
                    w: blockW - 2,
                    h: blockH - 2,
                    vx: 0,
                    vy: 0,
                    active: true,
                    supported: true,
                    color: rowIdx < 2 ? 0x795548 : rowIdx < 4 ? 0x8D6E63 : 0xA1887F
                });
            });
        });
    }

    _placeExplosive(pointer) {
        if (this.explosivesLeft <= 0) return;

        const px = pointer.x;
        const py = pointer.y;

        // Find clicked block
        const hitBlock = this.blocks.find(b =>
            b.active && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h
        );

        if (!hitBlock) return;

        this.explosivesLeft--;
        this.expText.setText(`Explosives: ${this.explosivesLeft}`);

        // Explosion effect
        this._explode(hitBlock.x + hitBlock.w / 2, hitBlock.y + hitBlock.h / 2, 80);

        // Destroy hit block and nearby blocks
        const blastRadius = 80;
        this.blocks.forEach(b => {
            if (!b.active) return;
            const dx = (b.x + b.w / 2) - (hitBlock.x + hitBlock.w / 2);
            const dy = (b.y + b.h / 2) - (hitBlock.y + hitBlock.h / 2);
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < blastRadius) {
                if (dist < blastRadius * 0.4) {
                    // Destroy
                    b.active = false;
                    this.score += 10;
                    // Create debris
                    for (let d = 0; d < 3; d++) {
                        this.debris.push({
                            x: b.x + Math.random() * b.w,
                            y: b.y + Math.random() * b.h,
                            vx: (Math.random() - 0.5) * 6,
                            vy: -Math.random() * 5 - 2,
                            size: 4 + Math.random() * 6,
                            color: b.color,
                            life: 120
                        });
                    }
                } else {
                    // Push away
                    const force = (blastRadius - dist) / blastRadius * 4;
                    b.vx += (dx / dist) * force;
                    b.vy += (dy / dist) * force - 2;
                    b.supported = false;
                }
            }
        });

        // Unsupport blocks above destroyed ones
        this._recalcSupport();
        Launcher.updateScore(this.score);
    }

    _explode(x, y, radius) {
        // Visual explosion particles
        for (let i = 0; i < 15; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 5 + 2;
            this.debris.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 3,
                size: 3 + Math.random() * 4,
                color: Math.random() > 0.5 ? 0xFF8F00 : 0xFF5252,
                life: 40
            });
        }
    }

    _recalcSupport() {
        // Mark blocks as unsupported if nothing below them
        this.blocks.forEach(b => {
            if (!b.active || !b.supported) return;
            // Check if any active block is directly below
            const below = this.blocks.some(other =>
                other.active && other !== b &&
                Math.abs((other.x + other.w / 2) - (b.x + b.w / 2)) < b.w * 0.8 &&
                other.y > b.y && other.y - b.y < b.h + 5
            );
            const onGround = b.y + b.h >= this.groundY - 2;
            if (!below && !onGround) {
                b.supported = false;
            }
        });
    }

    _drawBlocks() {
        this.blockGraphics.clear();
        this.blocks.forEach(b => {
            if (!b.active) return;
            this.blockGraphics.fillStyle(b.color, 1);
            this.blockGraphics.fillRect(b.x, b.y, b.w, b.h);
            this.blockGraphics.lineStyle(1, 0x4E342E, 0.5);
            this.blockGraphics.strokeRect(b.x, b.y, b.w, b.h);
        });
    }

    update() {
        // Physics for unsupported blocks
        this.blocks.forEach(b => {
            if (!b.active || b.supported) return;

            b.vy += this.gravity;
            b.x += b.vx;
            b.y += b.vy;
            b.vx *= 0.98;

            // Ground collision
            if (b.y + b.h >= this.groundY) {
                b.y = this.groundY - b.h;
                b.vy *= -0.3;
                b.vx *= 0.7;
                if (Math.abs(b.vy) < 1) {
                    b.vy = 0;
                    b.supported = true;
                }
            }
        });

        // Debris
        this.debrisGraphics.clear();
        for (let i = this.debris.length - 1; i >= 0; i--) {
            const d = this.debris[i];
            d.vy += this.gravity * 0.5;
            d.x += d.vx;
            d.y += d.vy;
            d.life--;

            if (d.life <= 0 || d.y > this.groundY + 20) {
                this.debris.splice(i, 1);
                continue;
            }

            this.debrisGraphics.fillStyle(d.color, d.life / 60);
            this.debrisGraphics.fillRect(d.x - d.size / 2, d.y - d.size / 2, d.size, d.size);
        }

        this._drawBlocks();
    }
}

GameRegistry.register({
    id: 'DemoDay',
    title: 'Demo Day',
    classic: 'Rubble Trouble',
    character: 'sofia',
    mechanic: 'Precision explosives and structural collapse physics',
    iconColor: '#BF360C',
    iconEmoji: '💥',
    scene: DemoDay
});
