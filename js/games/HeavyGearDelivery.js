/**
 * Game 21: Heavy Gear Delivery
 * ===============================
 * Classic: Monster Truck | Character: Sofia (Engineering)
 * Mechanic: Suspension physics with cargo-balance "Lose Condition."
 */

class HeavyGearDelivery extends Phaser.Scene {
    constructor() {
        super({ key: 'HeavyGearDelivery' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.distance = 0;
        this.scrollX = 0;
        this.cargoBalance = 0; // -1 to 1 (0 = balanced)
        this.cargoHP = 100;
        this.gameOver = false;

        // Truck physics
        this.truckX = width * 0.25;
        this.truckY = 0;
        this.truckVY = 0;
        this.truckAngle = 0;
        this.truckSpeed = 0;
        this.wheelBounce = [0, 0]; // front/rear suspension

        // Terrain
        this.terrainPoints = [];
        this._generateTerrain();

        // Graphics
        this.bgGraphics = this.add.graphics();
        this.terrainGraphics = this.add.graphics().setDepth(2);
        this.truckGraphics = this.add.graphics().setDepth(5);
        this.cargoGraphics = this.add.graphics().setDepth(6);

        // HUD
        const charKey = CharacterFactory.createTexture(this, 'sofia', 1);
        this.add.image(25, 15, charKey).setDepth(10);
        this.add.text(50, 5, 'Sofia - Heavy Gear', {
            fontSize: '11px', color: '#64B5F6', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.cargoText = this.add.text(width - 10, 10, 'Cargo: 100%', {
            fontSize: '12px', color: '#4CAF50', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);
        this.distText = this.add.text(width - 10, 28, 'Dist: 0m', {
            fontSize: '12px', color: '#90A4AE', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);

        // Balance meter
        this.balanceGraphics = this.add.graphics().setDepth(10);

        this.add.text(width / 2, height - 12, 'Right=Gas | Left=Brake | Balance the cargo!', {
            fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.input.on('pointerdown', () => { this.touching = true; });
        this.input.on('pointerup', () => { this.touching = false; });
        this.touching = false;
    }

    _generateTerrain() {
        let x = 0;
        let y = this.scale.height * 0.6;

        for (let i = 0; i < 800; i++) {
            this.terrainPoints.push({ x, y });
            x += Phaser.Math.Between(15, 40);

            // More dramatic terrain
            if (Math.random() < 0.15) {
                y -= Phaser.Math.Between(20, 60); // Bump
            } else if (Math.random() < 0.1) {
                y += Phaser.Math.Between(15, 40); // Dip
            } else {
                y += (Math.random() - 0.5) * 20;
            }
            y = Phaser.Math.Clamp(y, this.scale.height * 0.25, this.scale.height * 0.8);
        }
    }

    _getTerrainYAt(worldX) {
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

    _getTerrainAngle(worldX) {
        const y1 = this._getTerrainYAt(worldX - 8);
        const y2 = this._getTerrainYAt(worldX + 8);
        return Math.atan2(y2 - y1, 16);
    }

    update() {
        if (this.gameOver) return;
        const { width, height } = this.scale;

        // Controls
        if (this.cursors.right.isDown || this.touching) {
            this.truckSpeed = Math.min(5, this.truckSpeed + 0.1);
        } else if (this.cursors.left.isDown) {
            this.truckSpeed = Math.max(0, this.truckSpeed - 0.15);
        } else {
            this.truckSpeed *= 0.99;
        }

        this.scrollX += this.truckSpeed;
        this.distance = Math.floor(this.scrollX / 10);
        this.distText.setText(`Dist: ${this.distance}m`);
        this.score = this.distance;
        Launcher.updateScore(this.score);

        // Truck terrain following
        const worldX = this.scrollX + this.truckX;
        const terrainY = this._getTerrainYAt(worldX);
        const terrainAngle = this._getTerrainAngle(worldX);

        // Suspension effect
        const targetY = terrainY - 22;
        this.truckVY += (targetY - this.truckY) * 0.15;
        this.truckVY *= 0.7;
        this.truckY += this.truckVY;
        this.truckAngle = terrainAngle;

        // Cargo balance - affected by terrain angle and bumps
        this.cargoBalance += terrainAngle * 0.3;
        this.cargoBalance += this.truckVY * 0.02;
        this.cargoBalance *= 0.95; // Damping

        // Cargo damage when unbalanced
        if (Math.abs(this.cargoBalance) > 0.5) {
            this.cargoHP -= Math.abs(this.cargoBalance) * 0.3;
            this.cargoText.setText(`Cargo: ${Math.round(this.cargoHP)}%`);
            this.cargoText.setColor(this.cargoHP > 50 ? '#4CAF50' : '#E53935');
        }

        if (this.cargoHP <= 0) {
            this.gameOver = true;
            this.add.text(width / 2, height / 2,
                `CARGO LOST!\nDistance: ${this.distance}m`, {
                    fontSize: '24px', color: '#E53935', align: 'center',
                    fontFamily: 'sans-serif', fontStyle: 'bold'
                }).setOrigin(0.5).setDepth(20);
            return;
        }

        // Wheel suspension bounce
        const frontWX = worldX + 20;
        const rearWX = worldX - 20;
        const frontTY = this._getTerrainYAt(frontWX);
        const rearTY = this._getTerrainYAt(rearWX);
        this.wheelBounce[0] += (frontTY - (this.truckY + 12) - this.wheelBounce[0]) * 0.3;
        this.wheelBounce[1] += (rearTY - (this.truckY + 12) - this.wheelBounce[1]) * 0.3;

        // --- Draw ---
        this.bgGraphics.clear();
        this.bgGraphics.fillGradientStyle(0x87CEEB, 0x87CEEB, 0xE1BEE7, 0xE1BEE7, 1);
        this.bgGraphics.fillRect(0, 0, width, height);

        // Terrain
        this.terrainGraphics.clear();
        this.terrainGraphics.fillStyle(0x6D4C41, 1);
        this.terrainGraphics.beginPath();
        this.terrainGraphics.moveTo(0, height);
        for (let sx = 0; sx <= width; sx += 3) {
            const ty = this._getTerrainYAt(this.scrollX + sx);
            this.terrainGraphics.lineTo(sx, ty);
        }
        this.terrainGraphics.lineTo(width, height);
        this.terrainGraphics.closePath();
        this.terrainGraphics.fillPath();
        // Surface
        this.terrainGraphics.lineStyle(2, 0x4CAF50, 1);
        this.terrainGraphics.beginPath();
        for (let sx = 0; sx <= width; sx += 3) {
            const ty = this._getTerrainYAt(this.scrollX + sx);
            if (sx === 0) this.terrainGraphics.moveTo(sx, ty);
            else this.terrainGraphics.lineTo(sx, ty);
        }
        this.terrainGraphics.strokePath();

        // --- Truck ---
        this.truckGraphics.clear();
        const tx = this.truckX;
        const ty = this.truckY;

        // Chassis
        this.truckGraphics.fillStyle(0x64B5F6, 1);
        this.truckGraphics.fillRoundedRect(tx - 28, ty - 14, 56, 18, 3);

        // Cab
        this.truckGraphics.fillStyle(0x42A5F5, 1);
        this.truckGraphics.fillRoundedRect(tx + 8, ty - 26, 20, 14, 2);
        this.truckGraphics.fillStyle(0xB3E5FC, 0.7);
        this.truckGraphics.fillRect(tx + 12, ty - 24, 14, 8);

        // Wheels with suspension
        const wheelR = 9;
        [-20, 20].forEach((wx, i) => {
            const wy = ty + 8 + this.wheelBounce[i];
            this.truckGraphics.fillStyle(0x333333, 1);
            this.truckGraphics.fillCircle(tx + wx, wy, wheelR);
            this.truckGraphics.fillStyle(0x555555, 1);
            this.truckGraphics.fillCircle(tx + wx, wy, wheelR - 3);
            // Suspension line
            this.truckGraphics.lineStyle(1, 0x999999, 0.5);
            this.truckGraphics.beginPath();
            this.truckGraphics.moveTo(tx + wx, ty + 4);
            this.truckGraphics.lineTo(tx + wx, wy - wheelR);
            this.truckGraphics.strokePath();
        });

        // --- Cargo ---
        this.cargoGraphics.clear();
        const cargoX = tx - 22;
        const cargoY = ty - 30;
        const tilt = this.cargoBalance * 15;

        // Cargo box (tilts based on balance)
        this.cargoGraphics.save && this.cargoGraphics.save();
        this.cargoGraphics.fillStyle(0xFF7043, 1);
        this.cargoGraphics.fillRoundedRect(
            cargoX + tilt * 2, cargoY, 30, 16, 2
        );
        this.cargoGraphics.lineStyle(1, 0xBF360C, 0.6);
        this.cargoGraphics.strokeRoundedRect(
            cargoX + tilt * 2, cargoY, 30, 16, 2
        );
        // Fragile marker
        this.cargoGraphics.fillStyle(0xffffff, 0.5);
        this.cargoGraphics.fillRect(cargoX + tilt * 2 + 8, cargoY + 4, 14, 8);

        // --- Balance meter ---
        this.balanceGraphics.clear();
        const meterX = width / 2 - 50;
        const meterY = 30;
        this.balanceGraphics.fillStyle(0x333333, 0.6);
        this.balanceGraphics.fillRoundedRect(meterX, meterY, 100, 10, 3);
        // Center mark
        this.balanceGraphics.fillStyle(0xffffff, 0.4);
        this.balanceGraphics.fillRect(meterX + 48, meterY, 4, 10);
        // Balance indicator
        const balX = meterX + 50 + this.cargoBalance * 45;
        const balColor = Math.abs(this.cargoBalance) < 0.3 ? 0x4CAF50 :
            Math.abs(this.cargoBalance) < 0.6 ? 0xFF8F00 : 0xE53935;
        this.balanceGraphics.fillStyle(balColor, 1);
        this.balanceGraphics.fillCircle(balX, meterY + 5, 5);
    }
}

GameRegistry.register({
    id: 'HeavyGearDelivery',
    title: 'Heavy Gear Delivery',
    classic: 'Monster Truck',
    character: 'sofia',
    mechanic: 'Suspension physics with cargo-balance condition',
    iconColor: '#E65100',
    iconEmoji: '🚚',
    scene: HeavyGearDelivery
});
