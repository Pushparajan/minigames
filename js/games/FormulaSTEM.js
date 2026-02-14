/**
 * Game 17: Formula STEM
 * =======================
 * Classic: Turbo Racing | Character: Zack (Computer Science)
 * Mechanic: Top-down drifting physics with waypoint racing system.
 */

class FormulaSTEM extends Phaser.Scene {
    constructor() {
        super({ key: 'FormulaSTEM' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.lap = 0;
        this.maxLaps = 3;
        this.carX = width * 0.5;
        this.carY = height * 0.8;
        this.carAngle = -Math.PI / 2;
        this.carSpeed = 0;
        this.maxSpeed = 5;
        this.turnRate = 0;
        this.driftFactor = 0;

        // Track waypoints (oval-ish track)
        this.waypoints = [
            { x: width * 0.5, y: height * 0.85 },
            { x: width * 0.2, y: height * 0.7 },
            { x: width * 0.1, y: height * 0.4 },
            { x: width * 0.2, y: height * 0.15 },
            { x: width * 0.5, y: height * 0.08 },
            { x: width * 0.8, y: height * 0.15 },
            { x: width * 0.9, y: height * 0.4 },
            { x: width * 0.8, y: height * 0.7 },
        ];
        this.currentWP = 0;
        this.trackWidth = 50;

        // AI opponents
        this.aiCars = [];
        for (let i = 0; i < 3; i++) {
            this.aiCars.push({
                x: width * 0.5 + (i - 1) * 30,
                y: height * 0.85 + 30,
                angle: -Math.PI / 2,
                speed: 2.5 + Math.random(),
                wp: 0,
                color: [0x2196F3, 0x4CAF50, 0xFF9800][i]
            });
        }

        // Graphics
        this.trackGraphics = this.add.graphics();
        this.carGraphics = this.add.graphics().setDepth(5);

        // HUD
        this.add.text(10, 10, 'Zack - Formula STEM', {
            fontSize: '12px', color: '#00E676', fontFamily: 'sans-serif'
        }).setDepth(10);
        this.lapText = this.add.text(width / 2, 10, `Lap: 0/${this.maxLaps}`, {
            fontSize: '14px', color: '#ffffff', fontFamily: 'sans-serif'
        }).setOrigin(0.5, 0).setDepth(10);
        this.speedText = this.add.text(width - 10, 10, 'Speed: 0', {
            fontSize: '12px', color: '#76FF03', fontFamily: 'sans-serif'
        }).setOrigin(1, 0).setDepth(10);

        this.add.text(width / 2, height - 12, 'UP=Gas DOWN=Brake LEFT/RIGHT=Steer', {
            fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();

        // Touch steering
        this.input.on('pointermove', (p) => {
            this.touchX = (p.x / width - 0.5) * 2;
        });
        this.input.on('pointerdown', () => { this.touchAccel = true; });
        this.input.on('pointerup', () => { this.touchAccel = false; });
        this.touchX = 0;
        this.touchAccel = false;

        this._drawTrack();
    }

    _drawTrack() {
        const g = this.trackGraphics;
        g.clear();

        // Background
        g.fillStyle(0x2E7D32, 1);
        g.fillRect(0, 0, this.scale.width, this.scale.height);

        // Track surface
        g.lineStyle(this.trackWidth * 2, 0x555555, 1);
        g.beginPath();
        this.waypoints.forEach((wp, i) => {
            if (i === 0) g.moveTo(wp.x, wp.y);
            else g.lineTo(wp.x, wp.y);
        });
        g.lineTo(this.waypoints[0].x, this.waypoints[0].y);
        g.strokePath();

        // Track center line
        g.lineStyle(2, 0xFFFFFF, 0.3);
        g.beginPath();
        this.waypoints.forEach((wp, i) => {
            if (i === 0) g.moveTo(wp.x, wp.y);
            else g.lineTo(wp.x, wp.y);
        });
        g.lineTo(this.waypoints[0].x, this.waypoints[0].y);
        g.strokePath();

        // Start/Finish line
        g.lineStyle(4, 0xFFFFFF, 0.8);
        g.beginPath();
        g.moveTo(this.waypoints[0].x - 30, this.waypoints[0].y);
        g.lineTo(this.waypoints[0].x + 30, this.waypoints[0].y);
        g.strokePath();
    }

    update() {
        const { width, height } = this.scale;

        // --- Player controls ---
        let accel = 0;
        let steer = 0;

        if (this.cursors.up.isDown || this.touchAccel) accel = 0.12;
        if (this.cursors.down.isDown) accel = -0.08;
        if (this.cursors.left.isDown) steer = -0.04;
        if (this.cursors.right.isDown) steer = 0.04;
        if (this.touchX && this.touchAccel) steer = this.touchX * 0.04;

        // Speed
        this.carSpeed += accel;
        this.carSpeed *= 0.98; // friction
        this.carSpeed = Phaser.Math.Clamp(this.carSpeed, -2, this.maxSpeed);
        this.speedText.setText(`Speed: ${Math.round(Math.abs(this.carSpeed) * 30)}`);

        // Steering (speed-dependent)
        const steerMod = steer * (0.5 + Math.abs(this.carSpeed) * 0.2);
        this.carAngle += steerMod;

        // Drift effect
        this.driftFactor = Math.abs(steer) > 0.02 ? Math.min(1, this.driftFactor + 0.05) : Math.max(0, this.driftFactor - 0.03);

        // Move car
        this.carX += Math.cos(this.carAngle) * this.carSpeed;
        this.carY += Math.sin(this.carAngle) * this.carSpeed;

        // Keep on screen
        this.carX = Phaser.Math.Clamp(this.carX, 10, width - 10);
        this.carY = Phaser.Math.Clamp(this.carY, 10, height - 10);

        // Off-track penalty (check distance to nearest track segment)
        let onTrack = false;
        for (let i = 0; i < this.waypoints.length; i++) {
            const wp = this.waypoints[i];
            const dx = this.carX - wp.x;
            const dy = this.carY - wp.y;
            if (Math.sqrt(dx * dx + dy * dy) < this.trackWidth * 1.5) {
                onTrack = true;
                break;
            }
        }
        if (!onTrack) {
            this.carSpeed *= 0.95; // slow down off track
        }

        // Waypoint progression
        const wp = this.waypoints[this.currentWP];
        const wpDx = this.carX - wp.x;
        const wpDy = this.carY - wp.y;
        if (Math.sqrt(wpDx * wpDx + wpDy * wpDy) < 40) {
            this.currentWP++;
            if (this.currentWP >= this.waypoints.length) {
                this.currentWP = 0;
                this.lap++;
                this.lapText.setText(`Lap: ${this.lap}/${this.maxLaps}`);
                this.score += 300;
                Launcher.updateScore(this.score);

                if (this.lap >= this.maxLaps) {
                    this.add.text(width / 2, height / 2, 'RACE COMPLETE!', {
                        fontSize: '28px', color: '#FFD700',
                        fontFamily: 'sans-serif', fontStyle: 'bold'
                    }).setOrigin(0.5).setDepth(20);
                    this.scene.pause();
                }
            }
        }

        // --- AI Cars ---
        this.aiCars.forEach(ai => {
            const target = this.waypoints[ai.wp];
            const dx = target.x - ai.x;
            const dy = target.y - ai.y;
            const targetAngle = Math.atan2(dy, dx);

            let angleDiff = targetAngle - ai.angle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            ai.angle += angleDiff * 0.06;

            ai.x += Math.cos(ai.angle) * ai.speed;
            ai.y += Math.sin(ai.angle) * ai.speed;

            if (Math.sqrt(dx * dx + dy * dy) < 30) {
                ai.wp = (ai.wp + 1) % this.waypoints.length;
            }
        });

        // --- Draw cars ---
        this.carGraphics.clear();

        // AI cars
        this.aiCars.forEach(ai => {
            this.carGraphics.fillStyle(ai.color, 1);
            this._drawCarShape(this.carGraphics, ai.x, ai.y, ai.angle, 10, 6);
        });

        // Player car
        this.carGraphics.fillStyle(0x00E676, 1);
        this._drawCarShape(this.carGraphics, this.carX, this.carY, this.carAngle, 12, 7);

        // Drift marks
        if (this.driftFactor > 0.3) {
            this.trackGraphics.fillStyle(0x333333, 0.15);
            this.trackGraphics.fillCircle(
                this.carX - Math.cos(this.carAngle) * 10,
                this.carY - Math.sin(this.carAngle) * 10,
                3
            );
        }

        // Next waypoint indicator
        const nextWP = this.waypoints[this.currentWP];
        this.carGraphics.lineStyle(1, 0xFFD700, 0.5);
        this.carGraphics.strokeCircle(nextWP.x, nextWP.y, 15);
    }

    _drawCarShape(g, x, y, angle, length, halfWidth) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        g.beginPath();
        g.moveTo(x + cos * length, y + sin * length); // nose
        g.lineTo(x - cos * length * 0.6 - sin * halfWidth, y - sin * length * 0.6 + cos * halfWidth);
        g.lineTo(x - cos * length * 0.6 + sin * halfWidth, y - sin * length * 0.6 - cos * halfWidth);
        g.closePath();
        g.fillPath();
    }

    shutdown() {
        this.waypoints = [];
        this.aiCars = [];
    }
}

GameRegistry.register({
    id: 'FormulaSTEM',
    title: 'Formula STEM',
    classic: 'Turbo Racing',
    character: 'zack',
    mechanic: 'Top-down drifting physics with waypoint racing',
    iconColor: '#1B5E20',
    iconEmoji: '🏁',
    scene: FormulaSTEM
});
