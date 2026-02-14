/**
 * Game 25: STEM Celebration
 * ===========================
 * Classic: Dancing Bush | Character: Dev (Mathematics)
 * Mechanic: Rhythm-based input matching with time-window detection.
 */

class STEMCelebration extends Phaser.Scene {
    constructor() {
        super({ key: 'STEMCelebration' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.missCount = 0;
        this.maxMisses = 10;
        this.bpm = 120;
        this.beatInterval = 60000 / this.bpm;
        this.lastBeatTime = 0;
        this.gameOver = false;

        // Note lanes (4 directions)
        this.lanes = [
            { key: 'LEFT', x: width * 0.3, color: 0x2196F3, label: '←' },
            { key: 'DOWN', x: width * 0.4, color: 0x4CAF50, label: '↓' },
            { key: 'UP', x: width * 0.5, color: 0xFF9800, label: '↑' },
            { key: 'RIGHT', x: width * 0.6, color: 0xE53935, label: '→' },
        ];

        this.hitLineY = height - 80;
        this.spawnY = -20;
        this.noteSpeed = 3;

        // Active notes
        this.notes = [];
        this.effects = [];

        // Pre-generate song pattern
        this.songPattern = this._generateSong();
        this.songIndex = 0;
        this.songTime = 0;

        // Graphics
        this.bgGraphics = this.add.graphics();
        this.laneGraphics = this.add.graphics().setDepth(1);
        this.noteGraphics = this.add.graphics().setDepth(3);
        this.effectGraphics = this.add.graphics().setDepth(4);
        this.characterGraphics = this.add.graphics().setDepth(5);

        // Background
        this.bgGraphics.fillGradientStyle(0x1a0a2e, 0x2a0a3e, 0x1a0a2e, 0x2a0a3e, 1);
        this.bgGraphics.fillRect(0, 0, width, height);

        // Draw lane backgrounds
        this.lanes.forEach(lane => {
            this.laneGraphics.fillStyle(lane.color, 0.08);
            this.laneGraphics.fillRect(lane.x - 20, 0, 40, height);
        });

        // Hit line
        this.laneGraphics.lineStyle(3, 0xffffff, 0.6);
        this.laneGraphics.beginPath();
        this.laneGraphics.moveTo(this.lanes[0].x - 25, this.hitLineY);
        this.laneGraphics.lineTo(this.lanes[3].x + 25, this.hitLineY);
        this.laneGraphics.strokePath();

        // Target indicators
        this.lanes.forEach(lane => {
            this.laneGraphics.lineStyle(2, lane.color, 0.5);
            this.laneGraphics.strokeCircle(lane.x, this.hitLineY, 18);
        });

        // Character (Dev dancing)
        const charKey = CharacterFactory.createTexture(this, 'dev', 2);
        this.charSprite = this.add.image(width * 0.85, height * 0.5, charKey).setDepth(6);

        this.add.text(width * 0.85, height * 0.5 + 50, 'Dev', {
            fontSize: '13px', color: '#FFD54F', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(6);

        // HUD
        this.comboText = this.add.text(width * 0.85, 30, 'Combo: 0', {
            fontSize: '16px', color: '#FFD700', fontFamily: 'sans-serif'
        }).setOrigin(0.5).setDepth(10);

        this.judgmentText = this.add.text(width / 2, this.hitLineY + 30, '', {
            fontSize: '16px', color: '#ffffff', fontFamily: 'sans-serif', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(10);

        this.missText = this.add.text(10, 10, `Misses: 0/${this.maxMisses}`, {
            fontSize: '12px', color: '#E53935', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.add.text(width / 2, height - 12,
            'Arrow keys / Tap lanes when notes hit the line!', {
                fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
            }).setOrigin(0.5).setDepth(10);

        // Input
        this.input.keyboard.on('keydown-LEFT', () => this._hitLane(0));
        this.input.keyboard.on('keydown-DOWN', () => this._hitLane(1));
        this.input.keyboard.on('keydown-UP', () => this._hitLane(2));
        this.input.keyboard.on('keydown-RIGHT', () => this._hitLane(3));
        this.input.keyboard.on('keydown-A', () => this._hitLane(0));
        this.input.keyboard.on('keydown-S', () => this._hitLane(1));
        this.input.keyboard.on('keydown-W', () => this._hitLane(2));
        this.input.keyboard.on('keydown-D', () => this._hitLane(3));

        // Touch: tap on lane position
        this.input.on('pointerdown', (p) => {
            const laneIdx = this.lanes.findIndex(l => Math.abs(p.x - l.x) < 25);
            if (laneIdx >= 0) this._hitLane(laneIdx);
        });
    }

    _generateSong() {
        const pattern = [];
        const totalBeats = 100;

        for (let i = 0; i < totalBeats; i++) {
            if (Math.random() < 0.7) {
                pattern.push({
                    time: i * (this.beatInterval / 1000) * 60, // in frames
                    lane: Phaser.Math.Between(0, 3)
                });
            }
            // Occasional double notes
            if (Math.random() < 0.15) {
                pattern.push({
                    time: i * (this.beatInterval / 1000) * 60,
                    lane: Phaser.Math.Between(0, 3)
                });
            }
        }
        return pattern;
    }

    _hitLane(laneIdx) {
        if (this.gameOver) return;

        const lane = this.lanes[laneIdx];
        const hitWindow = 30; // pixels tolerance

        // Find closest note in this lane near the hit line
        let closestNote = null;
        let closestDist = Infinity;

        this.notes.forEach(note => {
            if (note.lane !== laneIdx || note.hit) return;
            const dist = Math.abs(note.y - this.hitLineY);
            if (dist < closestDist) {
                closestDist = dist;
                closestNote = note;
            }
        });

        if (closestNote && closestDist < hitWindow) {
            closestNote.hit = true;

            // Judge timing
            let judgment, points, color;
            if (closestDist < 8) {
                judgment = 'PERFECT'; points = 100; color = '#FFD700';
            } else if (closestDist < 18) {
                judgment = 'GREAT'; points = 50; color = '#76FF03';
            } else {
                judgment = 'OK'; points = 25; color = '#90A4AE';
            }

            this.combo++;
            this.maxCombo = Math.max(this.maxCombo, this.combo);
            this.score += points * (1 + Math.floor(this.combo / 10));
            Launcher.updateScore(this.score);

            this.comboText.setText(`Combo: ${this.combo}`);
            this.judgmentText.setText(judgment);
            this.judgmentText.setColor(color);

            // Hit effect
            this.effects.push({
                x: lane.x, y: this.hitLineY,
                radius: 18, color: lane.color,
                life: 15
            });

            // Character dance
            this.charSprite.setScale(1.1);
            this.time.delayedCall(100, () => this.charSprite.setScale(1));
        } else {
            // Miss (pressed but no note)
            this.combo = 0;
            this.comboText.setText('Combo: 0');
        }
    }

    update() {
        if (this.gameOver) return;
        const { width, height } = this.scale;

        this.songTime++;

        // Spawn notes from song pattern
        while (this.songIndex < this.songPattern.length &&
            this.songPattern[this.songIndex].time <= this.songTime) {
            const sp = this.songPattern[this.songIndex];
            this.notes.push({
                lane: sp.lane,
                x: this.lanes[sp.lane].x,
                y: this.spawnY,
                hit: false
            });
            this.songIndex++;
        }

        // --- Update notes ---
        this.noteGraphics.clear();
        for (let i = this.notes.length - 1; i >= 0; i--) {
            const note = this.notes[i];
            note.y += this.noteSpeed;

            if (note.hit) {
                this.notes.splice(i, 1);
                continue;
            }

            // Missed (past hit line)
            if (note.y > this.hitLineY + 40) {
                this.notes.splice(i, 1);
                this.combo = 0;
                this.comboText.setText('Combo: 0');
                this.missCount++;
                this.missText.setText(`Misses: ${this.missCount}/${this.maxMisses}`);
                this.judgmentText.setText('MISS');
                this.judgmentText.setColor('#FF5252');

                if (this.missCount >= this.maxMisses) {
                    this.gameOver = true;
                    this.add.text(width / 2, height / 2,
                        `GAME OVER!\nScore: ${this.score}\nMax Combo: ${this.maxCombo}`, {
                            fontSize: '22px', color: '#FFD700', align: 'center',
                            fontFamily: 'sans-serif', fontStyle: 'bold'
                        }).setOrigin(0.5).setDepth(20);
                }
                continue;
            }

            // Draw note
            const lane = this.lanes[note.lane];
            const proximity = 1 - Math.abs(note.y - this.hitLineY) / height;
            const noteSize = 14 + proximity * 4;

            this.noteGraphics.fillStyle(lane.color, 0.9);
            this.noteGraphics.fillCircle(note.x, note.y, noteSize);
            this.noteGraphics.fillStyle(0xffffff, 0.4);
            this.noteGraphics.fillCircle(note.x - 3, note.y - 3, noteSize * 0.3);

            // Arrow label
            this.noteGraphics.fillStyle(0xffffff, 0.8);
            // Simple directional indicator using small shapes
            const s = noteSize * 0.4;
            if (note.lane === 0) { // Left
                this.noteGraphics.beginPath();
                this.noteGraphics.moveTo(note.x - s, note.y);
                this.noteGraphics.lineTo(note.x + s * 0.5, note.y - s);
                this.noteGraphics.lineTo(note.x + s * 0.5, note.y + s);
                this.noteGraphics.closePath();
                this.noteGraphics.fillPath();
            } else if (note.lane === 1) { // Down
                this.noteGraphics.beginPath();
                this.noteGraphics.moveTo(note.x, note.y + s);
                this.noteGraphics.lineTo(note.x - s, note.y - s * 0.5);
                this.noteGraphics.lineTo(note.x + s, note.y - s * 0.5);
                this.noteGraphics.closePath();
                this.noteGraphics.fillPath();
            } else if (note.lane === 2) { // Up
                this.noteGraphics.beginPath();
                this.noteGraphics.moveTo(note.x, note.y - s);
                this.noteGraphics.lineTo(note.x - s, note.y + s * 0.5);
                this.noteGraphics.lineTo(note.x + s, note.y + s * 0.5);
                this.noteGraphics.closePath();
                this.noteGraphics.fillPath();
            } else { // Right
                this.noteGraphics.beginPath();
                this.noteGraphics.moveTo(note.x + s, note.y);
                this.noteGraphics.lineTo(note.x - s * 0.5, note.y - s);
                this.noteGraphics.lineTo(note.x - s * 0.5, note.y + s);
                this.noteGraphics.closePath();
                this.noteGraphics.fillPath();
            }
        }

        // --- Effects ---
        this.effectGraphics.clear();
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const e = this.effects[i];
            e.radius += 2;
            e.life--;
            if (e.life <= 0) {
                this.effects.splice(i, 1);
                continue;
            }
            this.effectGraphics.lineStyle(2, e.color, e.life / 15);
            this.effectGraphics.strokeCircle(e.x, e.y, e.radius);
        }

        // --- Character dance animation ---
        const dancePhase = Math.sin(this.songTime * 0.08) * 5;
        this.charSprite.setY(height * 0.5 + dancePhase);

        // Beat pulse on background
        const beatPhase = (this.songTime % 30) / 30;
        if (beatPhase < 0.1) {
            this.bgGraphics.fillStyle(0xffffff, 0.03);
            this.bgGraphics.fillRect(0, 0, width, height);
        }

        // Song complete
        if (this.songIndex >= this.songPattern.length && this.notes.length === 0 && !this.gameOver) {
            this.gameOver = true;
            this.add.text(width / 2, height / 2,
                `CELEBRATION COMPLETE!\nScore: ${this.score}\nMax Combo: ${this.maxCombo}`, {
                    fontSize: '22px', color: '#FFD700', align: 'center',
                    fontFamily: 'sans-serif', fontStyle: 'bold'
                }).setOrigin(0.5).setDepth(20);
        }
    }
}

GameRegistry.register({
    id: 'STEMCelebration',
    title: 'STEM Celebration',
    classic: 'Dancing Bush',
    character: 'dev',
    mechanic: 'Rhythm-based input matching with timing windows',
    iconColor: '#4A148C',
    iconEmoji: '🎵',
    scene: STEMCelebration
});
