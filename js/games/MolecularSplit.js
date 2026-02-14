/**
 * Game 20: Molecular Split
 * ==========================
 * Classic: Bubble Trouble | Character: Andrés (Chemistry)
 * Mechanic: Vertical harpoon collision that splits circles into smaller sizes.
 */

class MolecularSplit extends Phaser.Scene {
    constructor() {
        super({ key: 'MolecularSplit' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.lives = 3;
        this.groundY = height - 40;
        this.playerX = width / 2;
        this.harpoon = null;
        this.molecules = [];
        this.level = 1;

        // Start with initial molecules
        this._spawnLevel();

        // Graphics
        this.bgGraphics = this.add.graphics();
        this.molGraphics = this.add.graphics().setDepth(3);
        this.playerGraphics = this.add.graphics().setDepth(5);
        this.harpoonGraphics = this.add.graphics().setDepth(4);

        // Background
        this.bgGraphics.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x0a0a1e, 0x0a0a1e, 1);
        this.bgGraphics.fillRect(0, 0, width, height);
        this.bgGraphics.fillStyle(0x2a2a3e, 1);
        this.bgGraphics.fillRect(0, this.groundY, width, height - this.groundY);

        // Walls
        this.bgGraphics.fillStyle(0x333355, 1);
        this.bgGraphics.fillRect(0, 0, 8, height);
        this.bgGraphics.fillRect(width - 8, 0, 8, height);
        this.bgGraphics.fillRect(0, 0, width, 8);

        // Character
        const charKey = CharacterFactory.createTexture(this, 'andres', 1);
        this.add.image(25, 20, charKey).setDepth(10);
        this.add.text(50, 12, 'Andrés - Molecular Split', {
            fontSize: '11px', color: '#FF9800', fontFamily: 'sans-serif'
        }).setDepth(10);

        // HUD
        this.livesText = this.add.text(width - 10, 10, `Lives: ${this.lives}`, {
            fontSize: '13px', color: '#E53935', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);
        this.levelText = this.add.text(width / 2, 15, `Level ${this.level}`, {
            fontSize: '13px', color: '#ffffff', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        this.add.text(width / 2, height - 12, 'Left/Right to move | Space/Tap to fire harpoon', {
            fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.input.keyboard.on('keydown-SPACE', () => this._fireHarpoon());
        this.input.on('pointerdown', (p) => {
            this._fireHarpoon();
            this.touchTarget = p.x;
        });
        this.input.on('pointermove', (p) => {
            if (this.input.activePointer.isDown) this.touchTarget = p.x;
        });
        this.input.on('pointerup', () => { this.touchTarget = null; });
        this.touchTarget = null;
    }

    _spawnLevel() {
        this.molecules = [];
        const count = Math.min(this.level, 4);
        const { width } = this.scale;

        for (let i = 0; i < count; i++) {
            this.molecules.push({
                x: width * 0.2 + (width * 0.6 / count) * i,
                y: 100 + Math.random() * 80,
                vx: (Math.random() - 0.5) * 3 + (i % 2 === 0 ? 1.5 : -1.5),
                vy: 0,
                radius: 30,
                color: [0xE53935, 0x2196F3, 0x4CAF50, 0xFF9800][i % 4]
            });
        }
    }

    _fireHarpoon() {
        if (this.harpoon) return;
        this.harpoon = {
            x: this.playerX,
            y: this.groundY - 20,
            topY: this.groundY - 20,
            speed: 6,
            active: true
        };
    }

    _splitMolecule(mol, index) {
        this.molecules.splice(index, 1);
        this.score += Math.round(100 / mol.radius * 10);
        Launcher.updateScore(this.score);

        // Split into 2 smaller molecules if big enough
        const newRadius = mol.radius * 0.6;
        if (newRadius >= 10) {
            this.molecules.push({
                x: mol.x - newRadius,
                y: mol.y,
                vx: -Math.abs(mol.vx) - 0.5,
                vy: -3,
                radius: newRadius,
                color: mol.color
            });
            this.molecules.push({
                x: mol.x + newRadius,
                y: mol.y,
                vx: Math.abs(mol.vx) + 0.5,
                vy: -3,
                radius: newRadius,
                color: mol.color
            });
        }
    }

    update() {
        const { width, height } = this.scale;

        // Player movement
        if (this.cursors.left.isDown) this.playerX -= 4;
        if (this.cursors.right.isDown) this.playerX += 4;
        if (this.touchTarget !== null) {
            const diff = this.touchTarget - this.playerX;
            this.playerX += Math.sign(diff) * Math.min(Math.abs(diff), 5);
        }
        this.playerX = Phaser.Math.Clamp(this.playerX, 20, width - 20);

        // --- Molecules physics ---
        this.molGraphics.clear();
        const gravity = 0.12;
        const bounce = 0.98;

        for (let i = this.molecules.length - 1; i >= 0; i--) {
            const m = this.molecules[i];

            // Gravity
            m.vy += gravity;
            m.x += m.vx;
            m.y += m.vy;

            // Wall bounce
            if (m.x - m.radius < 8) { m.x = 8 + m.radius; m.vx = Math.abs(m.vx); }
            if (m.x + m.radius > width - 8) { m.x = width - 8 - m.radius; m.vx = -Math.abs(m.vx); }
            // Ceiling
            if (m.y - m.radius < 8) { m.y = 8 + m.radius; m.vy = Math.abs(m.vy); }
            // Ground bounce
            if (m.y + m.radius > this.groundY) {
                m.y = this.groundY - m.radius;
                m.vy = -Math.abs(m.vy) * bounce;
                // Ensure minimum bounce height
                if (Math.abs(m.vy) < 2) m.vy = -4 - m.radius * 0.1;
            }

            // Draw molecule
            this.molGraphics.fillStyle(m.color, 0.85);
            this.molGraphics.fillCircle(m.x, m.y, m.radius);
            // Highlight
            this.molGraphics.fillStyle(0xffffff, 0.25);
            this.molGraphics.fillCircle(m.x - m.radius * 0.25, m.y - m.radius * 0.25, m.radius * 0.4);
            // Orbit ring
            this.molGraphics.lineStyle(1, 0xffffff, 0.2);
            this.molGraphics.strokeCircle(m.x, m.y, m.radius * 0.7);

            // Player collision
            const pdx = m.x - this.playerX;
            const pdy = m.y - (this.groundY - 15);
            if (Math.sqrt(pdx * pdx + pdy * pdy) < m.radius + 10) {
                this.lives--;
                this.livesText.setText(`Lives: ${this.lives}`);
                this.playerX = width / 2;
                this.harpoon = null;
                if (this.lives <= 0) {
                    this.add.text(width / 2, height / 2, 'GAME OVER', {
                        fontSize: '28px', color: '#E53935',
                        fontFamily: 'sans-serif', fontStyle: 'bold'
                    }).setOrigin(0.5).setDepth(20);
                    this.scene.pause();
                }
                break;
            }
        }

        // --- Harpoon ---
        this.harpoonGraphics.clear();
        if (this.harpoon && this.harpoon.active) {
            this.harpoon.topY -= this.harpoon.speed;

            // Draw harpoon line
            this.harpoonGraphics.lineStyle(2, 0x00E676, 0.9);
            this.harpoonGraphics.beginPath();
            this.harpoonGraphics.moveTo(this.harpoon.x, this.groundY - 20);
            this.harpoonGraphics.lineTo(this.harpoon.x, this.harpoon.topY);
            this.harpoonGraphics.strokePath();

            // Arrow tip
            this.harpoonGraphics.fillStyle(0x00E676, 1);
            this.harpoonGraphics.beginPath();
            this.harpoonGraphics.moveTo(this.harpoon.x, this.harpoon.topY - 6);
            this.harpoonGraphics.lineTo(this.harpoon.x - 4, this.harpoon.topY + 2);
            this.harpoonGraphics.lineTo(this.harpoon.x + 4, this.harpoon.topY + 2);
            this.harpoonGraphics.closePath();
            this.harpoonGraphics.fillPath();

            // Hit ceiling
            if (this.harpoon.topY <= 10) {
                this.harpoon = null;
            } else {
                // Check collision with molecules
                for (let i = this.molecules.length - 1; i >= 0; i--) {
                    const m = this.molecules[i];
                    if (Math.abs(this.harpoon.x - m.x) < m.radius &&
                        this.harpoon.topY < m.y + m.radius &&
                        this.harpoon.topY > m.y - m.radius) {
                        this._splitMolecule(m, i);
                        this.harpoon = null;
                        break;
                    }
                }
            }
        }

        // --- Draw player ---
        this.playerGraphics.clear();
        // Body
        this.playerGraphics.fillStyle(0xFFFFFF, 1);
        this.playerGraphics.fillRoundedRect(this.playerX - 10, this.groundY - 30, 20, 28, 3);
        // Apron
        this.playerGraphics.fillStyle(0xFF9800, 1);
        this.playerGraphics.fillRect(this.playerX - 8, this.groundY - 12, 16, 3);
        // Eyes
        this.playerGraphics.fillStyle(0x111111, 1);
        this.playerGraphics.fillCircle(this.playerX - 3, this.groundY - 22, 1.5);
        this.playerGraphics.fillCircle(this.playerX + 3, this.groundY - 22, 1.5);

        // Level complete
        if (this.molecules.length === 0) {
            this.level++;
            this.levelText.setText(`Level ${this.level}`);
            this._spawnLevel();
        }
    }
}

GameRegistry.register({
    id: 'MolecularSplit',
    title: 'Molecular Split',
    classic: 'Bubble Trouble',
    character: 'andres',
    mechanic: 'Vertical harpoon splits circles into smaller sizes',
    iconColor: '#E65100',
    iconEmoji: '🔬',
    scene: MolecularSplit
});
