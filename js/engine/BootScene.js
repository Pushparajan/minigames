/**
 * BootScene.js
 * ==============
 * Universal boot scene that initializes shared resources and
 * displays a brief loading screen before transitioning to the
 * selected game scene.
 */

class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    init(data) {
        /** @type {string} The game ID to launch after boot */
        this.targetGameId = data.gameId || null;
    }

    create() {
        const { width, height } = this.scale;

        // Loading text
        const loadText = this.add.text(width / 2, height / 2, 'Loading...', {
            fontSize: '24px',
            color: '#ffffff',
            fontFamily: 'Segoe UI, sans-serif'
        }).setOrigin(0.5);

        // Brand text
        this.add.text(width / 2, height / 2 + 40, 'STEM School Adventures', {
            fontSize: '14px',
            color: '#6666aa',
            fontFamily: 'Segoe UI, sans-serif'
        }).setOrigin(0.5);

        // Transition to target game scene
        if (this.targetGameId) {
            this.time.delayedCall(400, () => {
                loadText.destroy();
                this.scene.start(this.targetGameId);
            });
        }
    }
}
