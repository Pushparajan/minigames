/**
 * Game 7: Campus Dash
 * =====================
 * Classic: On the Run | Character: Nadia (Biology)
 * Mechanic: Pseudo-3D sprite scaling for a high-speed racing effect.
 */

class CampusDash extends Phaser.Scene {
    constructor() {
        super({ key: 'CampusDash' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.speed = 0;
        this.maxSpeed = 12;
        this.playerX = 0; // -1 to 1 range (lane position)
        this.roadSegments = [];
        this.obstacles = [];
        this.distance = 0;
        this.lives = 3;

        // Pre-compute road
        this.roadWidth = width * 0.6;
        this.vanishY = height * 0.35;
        this.segmentCount = 100;

        for (let i = 0; i < this.segmentCount; i++) {
            this.roadSegments.push({
                curve: Math.sin(i * 0.05) * 2,
                hill: Math.cos(i * 0.03) * 0.5
            });
        }

        // Spawn obstacles
        for (let i = 10; i < this.segmentCount; i += Phaser.Math.Between(3, 7)) {
            this.obstacles.push({
                segIndex: i,
                lane: (Math.random() - 0.5) * 1.4, // position across road
                type: Math.random() > 0.7 ? 'bonus' : 'block'
            });
        }

        // Graphics
        this.roadGraphics = this.add.graphics();
        this.objGraphics = this.add.graphics().setDepth(5);

        // Character
        const charKey = CharacterFactory.createTexture(this, 'nadia', 2);
        this.playerSprite = this.add.image(width / 2, height - 80, charKey).setDepth(8);

        // HUD
        this.speedText = this.add.text(10, 10, 'Speed: 0', {
            fontSize: '13px', color: '#43A047', fontFamily: 'sans-serif'
        }).setDepth(10);
        this.livesText = this.add.text(10, 28, `Lives: ${this.lives}`, {
            fontSize: '13px', color: '#E53935', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.add.text(width / 2, height - 15, 'Left/Right or Tilt to steer | Tap to boost', {
            fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.input.on('pointermove', (p) => {
            this.playerX = ((p.x / width) - 0.5) * 2;
        });

        // Auto-accelerate
        this.speed = 3;
    }

    update() {
        const { width, height } = this.scale;

        // Steering
        if (this.cursors.left.isDown) this.playerX = Math.max(-1.2, this.playerX - 0.04);
        if (this.cursors.right.isDown) this.playerX = Math.min(1.2, this.playerX + 0.04);

        // Auto-speed
        this.speed = Math.min(this.maxSpeed, this.speed + 0.02);
        this.distance += this.speed * 0.01;

        this.speedText.setText(`Speed: ${Math.round(this.speed * 10)} km/h`);

        // Draw pseudo-3D road
        this.roadGraphics.clear();

        // Sky gradient
        this.roadGraphics.fillGradientStyle(0x87CEEB, 0x87CEEB, 0xB3E5FC, 0xB3E5FC, 1);
        this.roadGraphics.fillRect(0, 0, width, this.vanishY + 20);

        const baseIndex = Math.floor(this.distance * 10) % this.segmentCount;
        let accCurve = 0;

        for (let i = height; i > this.vanishY; i -= 4) {
            const perspective = (i - this.vanishY) / (height - this.vanishY);
            const segIdx = (baseIndex + Math.floor((1 - perspective) * 30)) % this.segmentCount;
            const seg = this.roadSegments[segIdx];

            accCurve += seg.curve * perspective * 0.01;
            const roadW = this.roadWidth * perspective;
            const cx = width / 2 + accCurve * width * 0.3 - this.playerX * roadW * 0.4;

            // Ground
            const groundColor = Math.floor((i + baseIndex * 3) / 8) % 2 === 0 ? 0x4CAF50 : 0x388E3C;
            this.roadGraphics.fillStyle(groundColor, 1);
            this.roadGraphics.fillRect(0, i, width, 4);

            // Road surface
            const roadColor = Math.floor((i + baseIndex * 3) / 8) % 2 === 0 ? 0x555555 : 0x444444;
            this.roadGraphics.fillStyle(roadColor, 1);
            this.roadGraphics.fillRect(cx - roadW / 2, i, roadW, 4);

            // Center line
            if (Math.floor((i + baseIndex * 5) / 12) % 2 === 0) {
                this.roadGraphics.fillStyle(0xFFFFFF, 0.8);
                this.roadGraphics.fillRect(cx - 2, i, 4, 4);
            }

            // Road edges
            this.roadGraphics.fillStyle(0xE53935, 1);
            this.roadGraphics.fillRect(cx - roadW / 2 - 4, i, 4, 4);
            this.roadGraphics.fillRect(cx + roadW / 2, i, 4, 4);
        }

        // Player car position
        const playerScreenX = width / 2 + this.playerX * this.roadWidth * 0.3;
        this.playerSprite.setX(playerScreenX);

        // Draw obstacles
        this.objGraphics.clear();
        this.obstacles.forEach(obs => {
            const relDist = (obs.segIndex - baseIndex + this.segmentCount) % this.segmentCount;
            if (relDist > 0 && relDist < 30) {
                const perspective = 1 - relDist / 30;
                const objY = this.vanishY + (height - this.vanishY) * perspective;
                const objX = width / 2 + obs.lane * this.roadWidth * perspective * 0.4
                    - this.playerX * this.roadWidth * perspective * 0.4;
                const objSize = 15 * perspective;

                if (obs.type === 'bonus') {
                    this.objGraphics.fillStyle(0xFFD700, 1);
                    this.objGraphics.fillCircle(objX, objY, objSize);
                } else {
                    this.objGraphics.fillStyle(0xE53935, 1);
                    this.objGraphics.fillRect(objX - objSize, objY - objSize, objSize * 2, objSize * 2);
                }

                // Collision (near player)
                if (perspective > 0.85 && perspective < 0.98) {
                    const dx = Math.abs(playerScreenX - objX);
                    if (dx < 25) {
                        if (obs.type === 'bonus') {
                            this.score += 50;
                            Launcher.updateScore(this.score);
                        } else {
                            this.lives--;
                            this.livesText.setText(`Lives: ${this.lives}`);
                            this.speed = Math.max(2, this.speed - 3);
                            if (this.lives <= 0) {
                                this.add.text(width / 2, height / 2, 'CRASH! GAME OVER', {
                                    fontSize: '28px', color: '#E53935',
                                    fontFamily: 'sans-serif', fontStyle: 'bold'
                                }).setOrigin(0.5).setDepth(20);
                                this.scene.pause();
                            }
                        }
                        obs.segIndex = -100; // Remove
                    }
                }
            }
        });

        // Score for distance
        this.score = Math.floor(this.distance * 100);
        Launcher.updateScore(this.score);
    }
}

GameRegistry.register({
    id: 'CampusDash',
    title: 'Campus Dash',
    classic: 'On the Run',
    character: 'nadia',
    mechanic: 'Pseudo-3D sprite scaling with high-speed racing',
    iconColor: '#2E7D32',
    iconEmoji: '🏎',
    scene: CampusDash
});
