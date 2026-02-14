/**
 * Game 15: Cable Car Conundrum
 * ==============================
 * Classic: Skywire | Character: Nadia (Biology)
 * Mechanic: Velocity-based momentum on a path (spline) with timing obstacles.
 */

class CableCarConundrum extends Phaser.Scene {
    constructor() {
        super({ key: 'CableCarConundrum' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.passengers = 3;
        this.speed = 0;
        this.maxSpeed = 4;
        this.pathT = 0; // Progress along path (0 to 1)
        this.gameOver = false;

        // Generate cable path (spline control points)
        this.pathPoints = [
            { x: 30, y: height * 0.4 },
            { x: width * 0.15, y: height * 0.3 },
            { x: width * 0.3, y: height * 0.5 },
            { x: width * 0.45, y: height * 0.25 },
            { x: width * 0.55, y: height * 0.55 },
            { x: width * 0.7, y: height * 0.35 },
            { x: width * 0.85, y: height * 0.5 },
            { x: width - 30, y: height * 0.4 },
        ];

        // Obstacles along the path
        this.obstacles = [
            { t: 0.2, type: 'bird', y: 0, size: 15 },
            { t: 0.4, type: 'wind', y: 0, size: 20 },
            { t: 0.55, type: 'bird', y: 0, size: 15 },
            { t: 0.7, type: 'wind', y: 0, size: 18 },
            { t: 0.85, type: 'bird', y: 0, size: 15 },
        ];

        // Collectibles
        this.collectibles = [];
        for (let t = 0.1; t < 0.95; t += 0.12) {
            this.collectibles.push({ t, collected: false });
        }

        // Graphics
        this.bgGraphics = this.add.graphics();
        this.pathGraphics = this.add.graphics().setDepth(2);
        this.carGraphics = this.add.graphics().setDepth(5);
        this.objGraphics = this.add.graphics().setDepth(4);

        // Character
        const charKey = CharacterFactory.createTexture(this, 'nadia', 1.2);
        this.add.image(30, 20, charKey).setDepth(10);
        this.add.text(55, 12, 'Nadia - Cable Car', {
            fontSize: '11px', color: '#43A047', fontFamily: 'sans-serif'
        }).setDepth(10);

        // HUD
        this.passengerText = this.add.text(width - 10, 10, `Passengers: ${this.passengers}`, {
            fontSize: '13px', color: '#43A047', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);

        this.speedText = this.add.text(width / 2, 10, 'Speed: 0', {
            fontSize: '12px', color: '#90A4AE', fontFamily: 'sans-serif'
        }).setOrigin(0.5, 0).setDepth(10);

        this.add.text(width / 2, height - 12,
            'Hold to accelerate | Release to brake | Avoid obstacles!', {
                fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
            }).setOrigin(0.5).setDepth(10);

        // Input
        this.input.on('pointerdown', () => { this.accelerating = true; });
        this.input.on('pointerup', () => { this.accelerating = false; });
        this.input.keyboard.on('keydown-SPACE', () => { this.accelerating = true; });
        this.input.keyboard.on('keyup-SPACE', () => { this.accelerating = false; });
        this.input.keyboard.on('keydown-RIGHT', () => { this.accelerating = true; });
        this.input.keyboard.on('keyup-RIGHT', () => { this.accelerating = false; });
        this.accelerating = false;

        this._drawBackground();
    }

    _getPointOnPath(t) {
        // Catmull-Rom spline interpolation
        t = Phaser.Math.Clamp(t, 0, 1);
        const pts = this.pathPoints;
        const n = pts.length - 1;
        const segT = t * n;
        const i = Math.min(Math.floor(segT), n - 1);
        const frac = segT - i;

        const p0 = pts[Math.max(i - 1, 0)];
        const p1 = pts[i];
        const p2 = pts[Math.min(i + 1, n)];
        const p3 = pts[Math.min(i + 2, n)];

        const tt = frac;
        const tt2 = tt * tt;
        const tt3 = tt2 * tt;

        const x = 0.5 * ((2 * p1.x) +
            (-p0.x + p2.x) * tt +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * tt3);

        const y = 0.5 * ((2 * p1.y) +
            (-p0.y + p2.y) * tt +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * tt3);

        return { x, y };
    }

    _drawBackground() {
        const { width, height } = this.scale;
        const bg = this.bgGraphics;
        bg.fillGradientStyle(0x87CEEB, 0x87CEEB, 0xB3E5FC, 0xB3E5FC, 1);
        bg.fillRect(0, 0, width, height);

        // Mountains
        bg.fillStyle(0x66BB6A, 0.6);
        for (let x = 0; x < width; x += 2) {
            const mh = Math.sin(x * 0.01) * 40 + Math.sin(x * 0.007) * 30 + 60;
            bg.fillRect(x, height - mh, 2, mh);
        }

        // Ground
        bg.fillStyle(0x4CAF50, 1);
        bg.fillRect(0, height - 30, width, 30);
    }

    update() {
        if (this.gameOver) return;
        const { width, height } = this.scale;

        // Speed control
        if (this.accelerating) {
            this.speed = Math.min(this.maxSpeed, this.speed + 0.08);
        } else {
            this.speed = Math.max(0, this.speed - 0.04);
        }

        // Progress along path
        this.pathT += this.speed * 0.001;
        this.speedText.setText(`Speed: ${Math.round(this.speed * 25)}`);

        // Win condition
        if (this.pathT >= 1) {
            this.score += this.passengers * 200;
            Launcher.updateScore(this.score);
            this.add.text(width / 2, height / 2,
                `ARRIVED SAFELY!\nPassengers: ${this.passengers}`, {
                    fontSize: '24px', color: '#43A047', align: 'center',
                    fontFamily: 'sans-serif', fontStyle: 'bold'
                }).setOrigin(0.5).setDepth(20);
            this.gameOver = true;
            return;
        }

        const carPos = this._getPointOnPath(this.pathT);

        // --- Draw cable path ---
        this.pathGraphics.clear();

        // Support towers
        this.pathPoints.forEach((p, i) => {
            if (i === 0 || i === this.pathPoints.length - 1 || i % 2 === 0) {
                this.pathGraphics.fillStyle(0x795548, 1);
                this.pathGraphics.fillRect(p.x - 3, p.y, 6, height - p.y - 30);
                this.pathGraphics.fillRect(p.x - 8, p.y - 3, 16, 6);
            }
        });

        // Cable line
        this.pathGraphics.lineStyle(2, 0x555555, 1);
        this.pathGraphics.beginPath();
        for (let t = 0; t <= 1; t += 0.005) {
            const p = this._getPointOnPath(t);
            if (t === 0) this.pathGraphics.moveTo(p.x, p.y);
            else this.pathGraphics.lineTo(p.x, p.y);
        }
        this.pathGraphics.strokePath();

        // --- Obstacles ---
        this.objGraphics.clear();
        this.obstacles.forEach(obs => {
            const op = this._getPointOnPath(obs.t);
            const bob = Math.sin(Date.now() / 300 + obs.t * 10) * 10;
            const ox = op.x;
            const oy = op.y - 20 + bob;

            if (obs.type === 'bird') {
                this.objGraphics.fillStyle(0x333333, 1);
                this.objGraphics.beginPath();
                this.objGraphics.moveTo(ox - 10, oy);
                this.objGraphics.lineTo(ox - 3, oy - 5);
                this.objGraphics.lineTo(ox, oy);
                this.objGraphics.lineTo(ox + 3, oy - 5);
                this.objGraphics.lineTo(ox + 10, oy);
                this.objGraphics.strokePath();
            } else {
                // Wind gust
                this.objGraphics.lineStyle(2, 0x90A4AE, 0.6);
                for (let w = -10; w <= 10; w += 10) {
                    this.objGraphics.beginPath();
                    this.objGraphics.moveTo(ox - 15, oy + w);
                    this.objGraphics.lineTo(ox + 15, oy + w);
                    this.objGraphics.strokePath();
                }
            }

            // Collision
            const dx = carPos.x - ox;
            const dy = carPos.y - oy;
            if (Math.sqrt(dx * dx + dy * dy) < obs.size + 12) {
                if (this.speed > 1.5) {
                    this.passengers--;
                    this.passengerText.setText(`Passengers: ${this.passengers}`);
                    obs.t = -1; // Remove
                    this.speed *= 0.3;
                    if (this.passengers <= 0) {
                        this.gameOver = true;
                        this.add.text(width / 2, height / 2, 'ALL PASSENGERS LOST!', {
                            fontSize: '24px', color: '#E53935',
                            fontFamily: 'sans-serif', fontStyle: 'bold'
                        }).setOrigin(0.5).setDepth(20);
                    }
                }
            }
        });

        // --- Collectibles ---
        this.collectibles.forEach(c => {
            if (c.collected) return;
            const cp = this._getPointOnPath(c.t);
            const bob = Math.sin(Date.now() / 250 + c.t * 5) * 4;
            this.objGraphics.fillStyle(0xFFD700, 0.9);
            this.objGraphics.fillCircle(cp.x, cp.y - 25 + bob, 6);

            if (Math.abs(carPos.x - cp.x) < 15 && Math.abs(carPos.y - (cp.y - 25)) < 15) {
                c.collected = true;
                this.score += 50;
                Launcher.updateScore(this.score);
            }
        });

        // --- Draw cable car ---
        this.carGraphics.clear();

        // Cable attachment
        this.carGraphics.lineStyle(2, 0x666666, 1);
        this.carGraphics.beginPath();
        this.carGraphics.moveTo(carPos.x, carPos.y);
        this.carGraphics.lineTo(carPos.x, carPos.y + 15);
        this.carGraphics.strokePath();

        // Car body
        this.carGraphics.fillStyle(0x43A047, 1);
        this.carGraphics.fillRoundedRect(carPos.x - 16, carPos.y + 15, 32, 20, 3);
        // Window
        this.carGraphics.fillStyle(0xB3E5FC, 0.8);
        this.carGraphics.fillRect(carPos.x - 12, carPos.y + 18, 24, 8);
        // Passenger dots
        for (let p = 0; p < this.passengers; p++) {
            this.carGraphics.fillStyle(0xFFE0B2, 1);
            this.carGraphics.fillCircle(carPos.x - 8 + p * 8, carPos.y + 22, 3);
        }

        // Wheel at cable
        this.carGraphics.fillStyle(0x333333, 1);
        this.carGraphics.fillCircle(carPos.x, carPos.y, 4);
    }
}

GameRegistry.register({
    id: 'CableCarConundrum',
    title: 'Cable Car Conundrum',
    classic: 'Skywire',
    character: 'nadia',
    mechanic: 'Velocity-based momentum on spline path',
    iconColor: '#2E7D32',
    iconEmoji: '🚡',
    scene: CableCarConundrum
});
