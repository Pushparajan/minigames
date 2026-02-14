/**
 * Game 12: Rover Field Test
 * ===========================
 * Classic: Dune Buggy | Character: Maya (Earth Science)
 * Mechanic: 2D wheel-joint physics with terrain-following constraints.
 */

class RoverFieldTest extends Phaser.Scene {
    constructor() {
        super({ key: 'RoverFieldTest' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.distance = 0;
        this.fuel = 100;
        this.gameOver = false;
        this.scrollX = 0;

        // Generate terrain
        this.terrainPoints = this._generateTerrain(width, height);
        this.terrainIndex = 0;

        // Rover properties
        this.roverX = width * 0.25;
        this.roverY = 0;
        this.roverAngle = 0;
        this.roverVX = 0;
        this.roverVY = 0;
        this.wheelAngle = 0;

        // Graphics
        this.bgGraphics = this.add.graphics();
        this.terrainGraphics = this.add.graphics().setDepth(2);
        this.roverGraphics = this.add.graphics().setDepth(5);

        // Character
        const charKey = CharacterFactory.createTexture(this, 'maya', 1.2);
        this.add.image(30, 20, charKey).setDepth(10);
        this.add.text(55, 12, 'Maya - Rover Field Test', {
            fontSize: '11px', color: '#8D6E63', fontFamily: 'sans-serif'
        }).setDepth(10);

        // HUD
        this.fuelText = this.add.text(width - 10, 10, `Fuel: 100%`, {
            fontSize: '13px', color: '#FF8F00', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);
        this.distText = this.add.text(width - 10, 28, 'Dist: 0m', {
            fontSize: '13px', color: '#4CAF50', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);

        this.add.text(width / 2, height - 12, 'Hold Right/Tap to accelerate | Left to brake', {
            fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.input.on('pointerdown', () => { this.touching = true; });
        this.input.on('pointerup', () => { this.touching = false; });
        this.touching = false;
    }

    _generateTerrain(w, h) {
        const points = [];
        const segments = 500;
        let x = 0;
        let y = h * 0.6;

        for (let i = 0; i < segments; i++) {
            points.push({ x, y });
            x += Phaser.Math.Between(20, 50);
            y += (Math.random() - 0.5) * 40;
            y = Phaser.Math.Clamp(y, h * 0.3, h * 0.85);

            // Occasional bumps
            if (Math.random() < 0.1) {
                y -= Phaser.Math.Between(20, 50);
            }
            if (Math.random() < 0.05) {
                y += Phaser.Math.Between(10, 30);
            }
        }
        return points;
    }

    _getTerrainYAt(worldX) {
        // Find the two terrain points bracketing worldX
        for (let i = 0; i < this.terrainPoints.length - 1; i++) {
            const p1 = this.terrainPoints[i];
            const p2 = this.terrainPoints[i + 1];
            if (worldX >= p1.x && worldX < p2.x) {
                const t = (worldX - p1.x) / (p2.x - p1.x);
                return p1.y + (p2.y - p1.y) * t;
            }
        }
        return this.scale.height * 0.6;
    }

    _getTerrainAngleAt(worldX) {
        const dx = 5;
        const y1 = this._getTerrainYAt(worldX - dx);
        const y2 = this._getTerrainYAt(worldX + dx);
        return Math.atan2(y2 - y1, dx * 2);
    }

    update() {
        if (this.gameOver) return;
        const { width, height } = this.scale;

        // Acceleration
        const accel = (this.cursors.right.isDown || this.touching) ? 0.15 : 0;
        const brake = this.cursors.left.isDown ? 0.95 : 0.995;

        if (accel > 0 && this.fuel > 0) {
            this.roverVX += accel;
            this.fuel -= 0.05;
            this.fuelText.setText(`Fuel: ${Math.round(this.fuel)}%`);
        }
        this.roverVX *= brake;
        this.roverVX = Phaser.Math.Clamp(this.roverVX, 0, 8);

        // Move rover
        this.scrollX += this.roverVX;
        this.distance = Math.floor(this.scrollX / 10);
        this.distText.setText(`Dist: ${this.distance}m`);
        this.score = this.distance;
        Launcher.updateScore(this.score);

        // Get terrain height at rover position
        const worldRoverX = this.scrollX + this.roverX;
        const terrainY = this._getTerrainYAt(worldRoverX);
        const terrainAngle = this._getTerrainAngleAt(worldRoverX);

        // Rover follows terrain
        this.roverY = terrainY - 16;
        this.roverAngle = terrainAngle;

        // Wheel rotation
        this.wheelAngle += this.roverVX * 0.2;

        // --- Draw background ---
        this.bgGraphics.clear();
        this.bgGraphics.fillGradientStyle(0x87CEEB, 0x87CEEB, 0xE1BEE7, 0xE1BEE7, 1);
        this.bgGraphics.fillRect(0, 0, width, height);

        // Mountains in background
        this.bgGraphics.fillStyle(0x7B8A6E, 0.4);
        for (let x = 0; x < width; x += 3) {
            const mh = Math.sin((x + this.scrollX * 0.1) * 0.008) * 60 + 80;
            this.bgGraphics.fillRect(x, height * 0.4 - mh, 3, mh + height * 0.6);
        }

        // --- Draw terrain ---
        this.terrainGraphics.clear();
        this.terrainGraphics.fillStyle(0x6D4C41, 1);
        this.terrainGraphics.beginPath();
        this.terrainGraphics.moveTo(0, height);

        for (let sx = 0; sx <= width; sx += 3) {
            const worldX = this.scrollX + sx;
            const ty = this._getTerrainYAt(worldX);
            this.terrainGraphics.lineTo(sx, ty);
        }

        this.terrainGraphics.lineTo(width, height);
        this.terrainGraphics.closePath();
        this.terrainGraphics.fillPath();

        // Terrain surface line
        this.terrainGraphics.lineStyle(2, 0x4CAF50, 1);
        this.terrainGraphics.beginPath();
        for (let sx = 0; sx <= width; sx += 3) {
            const worldX = this.scrollX + sx;
            const ty = this._getTerrainYAt(worldX);
            if (sx === 0) this.terrainGraphics.moveTo(sx, ty);
            else this.terrainGraphics.lineTo(sx, ty);
        }
        this.terrainGraphics.strokePath();

        // --- Draw Rover ---
        this.roverGraphics.clear();
        const rx = this.roverX;
        const ry = this.roverY;

        // Body
        this.roverGraphics.save();
        this.roverGraphics.fillStyle(0x8D6E63, 1);
        this.roverGraphics.fillRoundedRect(rx - 22, ry - 10, 44, 16, 3);

        // Cabin
        this.roverGraphics.fillStyle(0xA1887F, 1);
        this.roverGraphics.fillRoundedRect(rx - 10, ry - 20, 24, 12, 2);

        // Windshield
        this.roverGraphics.fillStyle(0x64B5F6, 0.7);
        this.roverGraphics.fillRect(rx + 6, ry - 18, 7, 8);

        // Wheels
        const wheelR = 7;
        const cos = Math.cos(this.wheelAngle);
        const sin = Math.sin(this.wheelAngle);

        [-16, 16].forEach(wx => {
            this.roverGraphics.fillStyle(0x333333, 1);
            this.roverGraphics.fillCircle(rx + wx, ry + 6, wheelR);
            this.roverGraphics.fillStyle(0x555555, 1);
            this.roverGraphics.fillCircle(rx + wx, ry + 6, wheelR - 2);
            // Spoke
            this.roverGraphics.lineStyle(1, 0x333333, 0.6);
            this.roverGraphics.beginPath();
            this.roverGraphics.moveTo(rx + wx - cos * 4, ry + 6 - sin * 4);
            this.roverGraphics.lineTo(rx + wx + cos * 4, ry + 6 + sin * 4);
            this.roverGraphics.strokePath();
        });

        // Antenna
        this.roverGraphics.lineStyle(1, 0x999999, 1);
        this.roverGraphics.beginPath();
        this.roverGraphics.moveTo(rx - 8, ry - 20);
        this.roverGraphics.lineTo(rx - 12, ry - 32);
        this.roverGraphics.strokePath();
        this.roverGraphics.fillStyle(0xE53935, 1);
        this.roverGraphics.fillCircle(rx - 12, ry - 33, 2);

        // Fuel check
        if (this.fuel <= 0 && this.roverVX < 0.1) {
            this.gameOver = true;
            this.add.text(width / 2, height / 2,
                `OUT OF FUEL!\nDistance: ${this.distance}m`, {
                    fontSize: '24px', color: '#FF5252', align: 'center',
                    fontFamily: 'sans-serif', fontStyle: 'bold'
                }).setOrigin(0.5).setDepth(20);
        }
    }
}

GameRegistry.register({
    id: 'RoverFieldTest',
    title: 'Rover Field Test',
    classic: 'Dune Buggy',
    character: 'maya',
    mechanic: '2D wheel-joint physics with terrain following',
    iconColor: '#5D4037',
    iconEmoji: '🚙',
    scene: RoverFieldTest
});
