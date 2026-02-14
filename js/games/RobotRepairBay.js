/**
 * Game 23: Robot Repair Bay
 * ===========================
 * Classic: Zombieworks | Character: Logicron (Logic AI)
 * Mechanic: Connect-the-pipes fluid logic to "reboot" robots.
 */

class RobotRepairBay extends Phaser.Scene {
    constructor() {
        super({ key: 'RobotRepairBay' });
    }

    create() {
        const { width, height } = this.scale;
        this.score = 0;
        this.level = 1;
        this.tileSize = Math.min(width / 9, height / 9, 56);
        this.gridCols = 7;
        this.gridRows = 7;
        this.gridOffsetX = (width - this.gridCols * this.tileSize) / 2;
        this.gridOffsetY = (height - this.gridRows * this.tileSize) / 2 + 15;

        // Pipe types: each has connections [top, right, bottom, left] as booleans
        this.PIPE_TYPES = {
            straight_h: { connections: [false, true, false, true], symbol: '─' },
            straight_v: { connections: [true, false, true, false], symbol: '│' },
            corner_tr: { connections: [true, true, false, false], symbol: '└' },
            corner_br: { connections: [false, true, true, false], symbol: '┌' },
            corner_bl: { connections: [false, false, true, true], symbol: '┐' },
            corner_tl: { connections: [true, false, false, true], symbol: '┘' },
            cross: { connections: [true, true, true, true], symbol: '┼' },
            t_right: { connections: [true, true, true, false], symbol: '├' },
            t_left: { connections: [true, false, true, true], symbol: '┤' },
            t_down: { connections: [false, true, true, true], symbol: '┬' },
            t_up: { connections: [true, true, false, true], symbol: '┴' },
        };
        this.pipeTypeKeys = Object.keys(this.PIPE_TYPES);

        // Generate puzzle
        this.grid = [];
        this.sourcePos = { r: 3, c: 0 };
        this.sinkPos = { r: 3, c: this.gridCols - 1 };
        this._generatePuzzle();

        // Graphics
        this.gridGraphics = this.add.graphics();

        // Character
        const charKey = CharacterFactory.createTexture(this, 'logicron', 1.2);
        this.add.image(30, 20, charKey).setDepth(10);
        this.add.text(55, 12, 'Logicron - Robot Repair', {
            fontSize: '11px', color: '#2196F3', fontFamily: 'sans-serif'
        }).setDepth(10);

        this.statusText = this.add.text(width / 2, height - 12,
            'Click/Tap a pipe to rotate it | Connect source to sink!', {
                fontSize: '10px', color: '#555577', fontFamily: 'sans-serif'
            }).setOrigin(0.5).setDepth(10);

        // Input
        this.input.on('pointerdown', this._onTileClick, this);

        this._draw();
    }

    _generatePuzzle() {
        this.grid = [];
        for (let r = 0; r < this.gridRows; r++) {
            this.grid[r] = [];
            for (let c = 0; c < this.gridCols; c++) {
                if ((r === this.sourcePos.r && c === this.sourcePos.c) ||
                    (r === this.sinkPos.r && c === this.sinkPos.c)) {
                    this.grid[r][c] = { type: 'straight_h', rotation: 0, fixed: true };
                } else {
                    // Random pipe, randomly rotated
                    const typeKey = this.pipeTypeKeys[Phaser.Math.Between(0, this.pipeTypeKeys.length - 1)];
                    const rotation = Phaser.Math.Between(0, 3);
                    this.grid[r][c] = { type: typeKey, rotation, fixed: false };
                }
            }
        }
    }

    _getConnections(r, c) {
        const cell = this.grid[r][c];
        const base = this.PIPE_TYPES[cell.type].connections;
        // Rotate connections
        const rot = cell.rotation % 4;
        const conns = [...base];
        for (let i = 0; i < rot; i++) {
            const last = conns.pop();
            conns.unshift(last);
        }
        return conns; // [top, right, bottom, left]
    }

    _checkFlow() {
        // BFS from source to sink
        const visited = new Set();
        const queue = [{ r: this.sourcePos.r, c: this.sourcePos.c }];
        visited.add(`${this.sourcePos.r},${this.sourcePos.c}`);

        const dirs = [
            { dr: -1, dc: 0, from: 0, to: 2 }, // up: check my top, neighbor's bottom
            { dr: 0, dc: 1, from: 1, to: 3 },   // right
            { dr: 1, dc: 0, from: 2, to: 0 },   // down
            { dr: 0, dc: -1, from: 3, to: 1 },   // left
        ];

        this.flowCells = new Set();
        this.flowCells.add(`${this.sourcePos.r},${this.sourcePos.c}`);

        while (queue.length > 0) {
            const { r, c } = queue.shift();
            const conns = this._getConnections(r, c);

            for (const dir of dirs) {
                if (!conns[dir.from]) continue;
                const nr = r + dir.dr;
                const nc = c + dir.dc;
                const key = `${nr},${nc}`;

                if (nr < 0 || nr >= this.gridRows || nc < 0 || nc >= this.gridCols) continue;
                if (visited.has(key)) continue;

                const neighborConns = this._getConnections(nr, nc);
                if (neighborConns[dir.to]) {
                    visited.add(key);
                    this.flowCells.add(key);
                    queue.push({ r: nr, c: nc });
                }
            }
        }

        return visited.has(`${this.sinkPos.r},${this.sinkPos.c}`);
    }

    _onTileClick(pointer) {
        const c = Math.floor((pointer.x - this.gridOffsetX) / this.tileSize);
        const r = Math.floor((pointer.y - this.gridOffsetY) / this.tileSize);

        if (r < 0 || r >= this.gridRows || c < 0 || c >= this.gridCols) return;
        if (this.grid[r][c].fixed) return;

        // Rotate pipe
        this.grid[r][c].rotation = (this.grid[r][c].rotation + 1) % 4;

        // Check if puzzle is solved
        const solved = this._checkFlow();
        this._draw();

        if (solved) {
            this.score += 500;
            Launcher.updateScore(this.score);
            this.statusText.setText('ROBOT REBOOTED! Flow connected!');
            this.add.text(this.scale.width / 2, this.scale.height / 2,
                'CONNECTED!', {
                    fontSize: '28px', color: '#00E676',
                    fontFamily: 'sans-serif', fontStyle: 'bold'
                }).setOrigin(0.5).setDepth(20);

            // Next level after delay
            this.time.delayedCall(1500, () => {
                this.level++;
                this._generatePuzzle();
                this.scene.restart();
            });
        }
    }

    _draw() {
        const g = this.gridGraphics;
        g.clear();

        // Background
        g.fillStyle(0x1a1a2e, 1);
        g.fillRect(0, 0, this.scale.width, this.scale.height);

        // Check flow for highlighting
        this._checkFlow();

        for (let r = 0; r < this.gridRows; r++) {
            for (let c = 0; c < this.gridCols; c++) {
                const x = this.gridOffsetX + c * this.tileSize;
                const y = this.gridOffsetY + r * this.tileSize;
                const ts = this.tileSize;
                const cell = this.grid[r][c];
                const isFlowing = this.flowCells && this.flowCells.has(`${r},${c}`);
                const isSource = r === this.sourcePos.r && c === this.sourcePos.c;
                const isSink = r === this.sinkPos.r && c === this.sinkPos.c;

                // Tile background
                g.fillStyle(isFlowing ? 0x1B5E20 : 0x222244, 1);
                g.fillRect(x + 1, y + 1, ts - 2, ts - 2);

                // Source/Sink markers
                if (isSource) {
                    g.fillStyle(0x4CAF50, 1);
                    g.fillCircle(x + ts / 2, y + ts / 2, 8);
                    g.fillStyle(0xffffff, 0.5);
                    g.fillCircle(x + ts / 2 - 2, y + ts / 2 - 2, 3);
                }
                if (isSink) {
                    g.fillStyle(0x2196F3, 1);
                    g.fillCircle(x + ts / 2, y + ts / 2, 8);
                }

                // Draw pipe connections
                const conns = this._getConnections(r, c);
                const cx = x + ts / 2;
                const cy = y + ts / 2;
                const pipeW = ts * 0.25;
                const pipeColor = isFlowing ? 0x76FF03 : 0x90A4AE;

                g.fillStyle(pipeColor, isFlowing ? 0.9 : 0.5);

                // Center block
                g.fillRect(cx - pipeW / 2, cy - pipeW / 2, pipeW, pipeW);

                // Top
                if (conns[0]) g.fillRect(cx - pipeW / 2, y + 1, pipeW, cy - y - pipeW / 2);
                // Right
                if (conns[1]) g.fillRect(cx + pipeW / 2, cy - pipeW / 2, x + ts - cx - pipeW / 2 - 1, pipeW);
                // Bottom
                if (conns[2]) g.fillRect(cx - pipeW / 2, cy + pipeW / 2, pipeW, y + ts - cy - pipeW / 2 - 1);
                // Left
                if (conns[3]) g.fillRect(x + 1, cy - pipeW / 2, cx - x - pipeW / 2, pipeW);
            }
        }
    }

    update() {}

    shutdown() {
        this.grid = [];
        this.flowCells = null;
        this.pipeTypeKeys = [];
    }
}

GameRegistry.register({
    id: 'RobotRepairBay',
    title: 'Robot Repair Bay',
    classic: 'Zombieworks',
    character: 'logicron',
    mechanic: 'Connect-the-pipes fluid logic to reboot robots',
    iconColor: '#263238',
    iconEmoji: '🔧',
    scene: RobotRepairBay
});
