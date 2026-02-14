/**
 * CharacterFactory.js
 * =====================
 * Renders STEM School Adventures characters using inline SVG sprites
 * based on the visual prompt descriptions. Falls back to Canvas-drawn
 * placeholders if SVGs are not loaded.
 */

const CharacterFactory = (() => {
    'use strict';

    /**
     * SVG file paths for each character.
     * These are loaded as Phaser textures via Image elements.
     */
    const SVG_PATHS = {
        guha: 'assets/svg/guha.svg',
        nadia: 'assets/svg/nadia.svg',
        logicron: 'assets/svg/logicron.svg',
        andres: 'assets/svg/andres.svg',
        dev: 'assets/svg/dev.svg',
        sofia: 'assets/svg/sofia.svg',
        rex: 'assets/svg/rex.svg',
        maya: 'assets/svg/maya.svg',
        zack: 'assets/svg/zack.svg',
        grandpaVidur: 'assets/svg/grandpaVidur.svg',
        arvi: 'assets/svg/arvi.svg',
        pancho: 'assets/svg/pancho.svg'
    };

    /** Cache of loaded SVG data URIs */
    const _svgCache = {};

    /** Track which SVGs have been loaded into Phaser */
    const _textureLoaded = {};

    /**
     * Character definition table.
     * Each entry contains drawing instructions for Canvas-based placeholders
     * and references to SVG sprite files.
     */
    const CHARACTERS = {
        guha: {
            name: 'Guha',
            role: 'Physics',
            primaryColor: '#E53935',   // Red hoodie
            secondaryColor: '#FDD835', // Lightning bolt
            accentColor: '#212121',    // Dark hair
            bodyWidth: 32,
            bodyHeight: 48,
            icon: 'lightning',
            description: 'Brave 10yo boy, red hoodie, lightning bolt patterns'
        },
        nadia: {
            name: 'Nadia',
            role: 'Biology',
            primaryColor: '#43A047',   // Green overalls
            secondaryColor: '#8D6E63', // Brown skin
            accentColor: '#33691E',    // Leaf embroidery
            bodyWidth: 30,
            bodyHeight: 46,
            icon: 'leaf',
            description: 'Nature-loving girl, green overalls, curly dark hair'
        },
        logicron: {
            name: 'Logicron',
            role: 'Logic AI',
            primaryColor: '#B0BEC5',   // Metallic silver
            secondaryColor: '#2196F3', // Glowing blue
            accentColor: '#00BCD4',    // Cyan glow
            bodyWidth: 36,
            bodyHeight: 36,
            icon: 'puzzle',
            description: 'Floating spherical AI, silver body, blue digital eyes'
        },
        andres: {
            name: 'Andrés',
            role: 'Chemistry',
            primaryColor: '#FFFFFF',   // Lab coat
            secondaryColor: '#FF9800', // Colorful apron
            accentColor: '#4CAF50',    // Beaker color
            bodyWidth: 36,
            bodyHeight: 52,
            icon: 'beaker',
            description: 'Cheerful man, lab coat, safety goggles, beaker'
        },
        dev: {
            name: 'Dev',
            role: 'Mathematics',
            primaryColor: '#FFF8E1',   // Kurta shirt
            secondaryColor: '#FFD54F', // Golden geometric glow
            accentColor: '#795548',    // Salt-and-pepper
            bodyWidth: 34,
            bodyHeight: 50,
            icon: 'geometry',
            description: 'Wise mentor, kurta shirt, holographic geometry'
        },
        sofia: {
            name: 'Sofia',
            role: 'Engineering',
            primaryColor: '#64B5F6',   // Light blue shirt
            secondaryColor: '#FF7043', // Tool belt
            accentColor: '#37474F',    // Dark hair
            bodyWidth: 30,
            bodyHeight: 46,
            icon: 'wrench',
            description: '11yo girl, tool belt, goggles, wrench and blueprint'
        },
        rex: {
            name: 'Rex',
            role: 'Misguided Inventor',
            primaryColor: '#7E57C2',   // Purple-ish coat
            secondaryColor: '#FFEE58', // Sparking gadget
            accentColor: '#FF5722',    // Spiky hair accent
            bodyWidth: 34,
            bodyHeight: 48,
            icon: 'spark',
            description: 'Quirky inventor, mismatched coat, crooked goggles'
        },
        maya: {
            name: 'Maya',
            role: 'Earth Science',
            primaryColor: '#8D6E63',   // Earth-tone jacket
            secondaryColor: '#4CAF50', // Globe green
            accentColor: '#3E2723',    // Braided hair
            bodyWidth: 28,
            bodyHeight: 42,
            icon: 'globe',
            description: '9yo girl, braided hair, earth-tone jacket, globe'
        },
        zack: {
            name: 'Zack',
            role: 'Computer Science',
            primaryColor: '#424242',   // Dark hoodie
            secondaryColor: '#00E676', // Pixel/neon green
            accentColor: '#76FF03',    // Holographic code
            bodyWidth: 30,
            bodyHeight: 46,
            icon: 'pixel',
            description: '10yo boy, pixel-pattern hoodie, holographic code'
        },
        grandpaVidur: {
            name: 'Grandpa Vidur',
            role: 'History of Science',
            primaryColor: '#D7CCC8',   // Traditional vest
            secondaryColor: '#FFE0B2', // Warm skin tone
            accentColor: '#9E9E9E',    // Silver hair
            bodyWidth: 36,
            bodyHeight: 52,
            icon: 'book',
            description: 'Elderly man, silver hair, round glasses, ancient book'
        },
        arvi: {
            name: 'Arvi 9000',
            role: 'Tech AI',
            primaryColor: '#ECEFF1',   // White body
            secondaryColor: '#2196F3', // Blue accents
            accentColor: '#00BCD4',    // Glow
            bodyWidth: 28,
            bodyHeight: 32,
            icon: 'antenna',
            description: 'Small hovering AI, white-blue body, digital face'
        },
        pancho: {
            name: 'Pancho',
            role: 'Musical Science',
            primaryColor: '#FF7043',   // Colorful patchwork
            secondaryColor: '#FFCA28', // Ukulele
            accentColor: '#AB47BC',    // Musical sparkles
            bodyWidth: 30,
            bodyHeight: 46,
            icon: 'music',
            description: '12yo boy, patchwork hoodie, ukulele, journal'
        }
    };

    /**
     * Preload all SVG character sprites into a Phaser scene's loader.
     * Call this from a scene's preload() method.
     *
     * @param {Phaser.Scene} scene - The scene to preload into.
     */
    function preloadAll(scene) {
        Object.entries(SVG_PATHS).forEach(([id, path]) => {
            const key = `svg_${id}`;
            if (!scene.textures.exists(key)) {
                scene.load.svg(key, path);
            }
        });
    }

    /**
     * Create a character texture. Prefers SVG sprite if loaded,
     * otherwise falls back to Canvas-drawn placeholder.
     *
     * @param {Phaser.Scene} scene - The active Phaser scene.
     * @param {string} characterId - Key from CHARACTERS table.
     * @param {number} [scale=1] - Scale multiplier.
     * @returns {string} The generated texture key.
     */
    function createTexture(scene, characterId, scale = 1) {
        const char = CHARACTERS[characterId];
        if (!char) {
            console.warn(`CharacterFactory: Unknown character "${characterId}"`);
            return null;
        }

        // Try SVG texture first
        const svgKey = `svg_${characterId}`;
        if (scene.textures.exists(svgKey)) {
            return svgKey;
        }

        // Fallback: Canvas-drawn placeholder
        const key = `char_${characterId}_${scale}`;
        if (scene.textures.exists(key)) return key;

        const w = Math.round(char.bodyWidth * scale);
        const h = Math.round(char.bodyHeight * scale);
        const g = scene.add.graphics();

        // Body
        g.fillStyle(Phaser.Display.Color.HexStringToColor(char.primaryColor).color, 1);
        g.fillRoundedRect(0, 0, w, h, 4 * scale);

        // Accent stripe
        g.fillStyle(Phaser.Display.Color.HexStringToColor(char.secondaryColor).color, 0.8);
        g.fillRect(2 * scale, h * 0.6, w - 4 * scale, 4 * scale);

        // Icon indicator
        _drawIcon(g, char.icon, w, h, char.secondaryColor, scale);

        // Eyes (two small dots)
        g.fillStyle(0xffffff, 1);
        g.fillCircle(w * 0.35, h * 0.25, 2.5 * scale);
        g.fillCircle(w * 0.65, h * 0.25, 2.5 * scale);
        g.fillStyle(0x111111, 1);
        g.fillCircle(w * 0.35, h * 0.25, 1.2 * scale);
        g.fillCircle(w * 0.65, h * 0.25, 1.2 * scale);

        g.generateTexture(key, w, h);
        g.destroy();
        return key;
    }

    /**
     * Create a circular ball-style texture for a character (used in billiards etc.)
     */
    function createBallTexture(scene, characterId, radius = 14) {
        const char = CHARACTERS[characterId];
        if (!char) return null;

        const key = `ball_${characterId}_${radius}`;
        if (scene.textures.exists(key)) return key;

        const d = radius * 2;
        const g = scene.add.graphics();

        // Outer circle
        g.fillStyle(Phaser.Display.Color.HexStringToColor(char.primaryColor).color, 1);
        g.fillCircle(radius, radius, radius);

        // Inner highlight
        g.fillStyle(0xffffff, 0.3);
        g.fillCircle(radius - radius * 0.2, radius - radius * 0.2, radius * 0.35);

        // Center icon dot
        g.fillStyle(Phaser.Display.Color.HexStringToColor(char.secondaryColor).color, 1);
        g.fillCircle(radius, radius, radius * 0.3);

        g.generateTexture(key, d, d);
        g.destroy();
        return key;
    }

    /**
     * Draw a small icon/symbol to distinguish each character.
     */
    function _drawIcon(graphics, iconType, w, h, color, scale) {
        const colorVal = Phaser.Display.Color.HexStringToColor(color).color;
        const cx = w * 0.5;
        const cy = h * 0.45;
        const s = scale;

        graphics.lineStyle(1.5 * s, colorVal, 1);

        switch (iconType) {
            case 'lightning':
                // Simple lightning bolt
                graphics.beginPath();
                graphics.moveTo(cx - 2 * s, cy - 6 * s);
                graphics.lineTo(cx + 1 * s, cy - 1 * s);
                graphics.lineTo(cx - 1 * s, cy + 1 * s);
                graphics.lineTo(cx + 2 * s, cy + 6 * s);
                graphics.strokePath();
                break;
            case 'leaf':
                // Simple leaf shape
                graphics.beginPath();
                graphics.arc(cx, cy, 4 * s, -0.8, 0.8);
                graphics.strokePath();
                graphics.beginPath();
                graphics.moveTo(cx - 4 * s, cy);
                graphics.lineTo(cx + 4 * s, cy);
                graphics.strokePath();
                break;
            case 'puzzle':
                // Puzzle piece hint
                graphics.strokeRect(cx - 3 * s, cy - 3 * s, 6 * s, 6 * s);
                graphics.fillStyle(colorVal, 0.5);
                graphics.fillCircle(cx + 3 * s, cy, 2 * s);
                break;
            case 'beaker':
                // Beaker outline
                graphics.beginPath();
                graphics.moveTo(cx - 3 * s, cy - 5 * s);
                graphics.lineTo(cx - 3 * s, cy + 3 * s);
                graphics.lineTo(cx + 3 * s, cy + 3 * s);
                graphics.lineTo(cx + 3 * s, cy - 5 * s);
                graphics.strokePath();
                graphics.fillStyle(colorVal, 0.4);
                graphics.fillRect(cx - 2.5 * s, cy, 5 * s, 3 * s);
                break;
            case 'geometry':
                // Triangle
                graphics.beginPath();
                graphics.moveTo(cx, cy - 5 * s);
                graphics.lineTo(cx - 4 * s, cy + 3 * s);
                graphics.lineTo(cx + 4 * s, cy + 3 * s);
                graphics.closePath();
                graphics.strokePath();
                break;
            case 'wrench':
                // Simple wrench
                graphics.beginPath();
                graphics.moveTo(cx - 4 * s, cy + 4 * s);
                graphics.lineTo(cx + 2 * s, cy - 2 * s);
                graphics.strokePath();
                graphics.strokeCircle(cx + 3 * s, cy - 3 * s, 2 * s);
                break;
            case 'spark':
                // Sparking lines
                for (let i = 0; i < 4; i++) {
                    const angle = (Math.PI * 2 / 4) * i + 0.4;
                    graphics.beginPath();
                    graphics.moveTo(cx, cy);
                    graphics.lineTo(cx + Math.cos(angle) * 5 * s, cy + Math.sin(angle) * 5 * s);
                    graphics.strokePath();
                }
                break;
            case 'globe':
                // Globe circle + meridian
                graphics.strokeCircle(cx, cy, 4 * s);
                graphics.beginPath();
                graphics.moveTo(cx - 4 * s, cy);
                graphics.lineTo(cx + 4 * s, cy);
                graphics.strokePath();
                graphics.beginPath();
                graphics.arc(cx, cy, 4 * s, -1.2, 1.2);
                graphics.strokePath();
                break;
            case 'pixel':
                // Pixel grid 2x2
                graphics.fillStyle(colorVal, 0.8);
                graphics.fillRect(cx - 3 * s, cy - 3 * s, 2.5 * s, 2.5 * s);
                graphics.fillRect(cx + 0.5 * s, cy - 3 * s, 2.5 * s, 2.5 * s);
                graphics.fillRect(cx - 3 * s, cy + 0.5 * s, 2.5 * s, 2.5 * s);
                graphics.fillRect(cx + 0.5 * s, cy + 0.5 * s, 2.5 * s, 2.5 * s);
                break;
            case 'book':
                // Open book
                graphics.beginPath();
                graphics.moveTo(cx, cy - 3 * s);
                graphics.lineTo(cx - 5 * s, cy - 4 * s);
                graphics.lineTo(cx - 5 * s, cy + 3 * s);
                graphics.lineTo(cx, cy + 2 * s);
                graphics.lineTo(cx + 5 * s, cy + 3 * s);
                graphics.lineTo(cx + 5 * s, cy - 4 * s);
                graphics.closePath();
                graphics.strokePath();
                break;
            case 'antenna':
                // Antenna with signal arcs
                graphics.beginPath();
                graphics.moveTo(cx, cy + 4 * s);
                graphics.lineTo(cx, cy - 3 * s);
                graphics.strokePath();
                graphics.fillStyle(colorVal, 1);
                graphics.fillCircle(cx, cy - 4 * s, 1.5 * s);
                break;
            case 'music':
                // Music note
                graphics.beginPath();
                graphics.moveTo(cx + 2 * s, cy - 5 * s);
                graphics.lineTo(cx + 2 * s, cy + 2 * s);
                graphics.strokePath();
                graphics.fillStyle(colorVal, 1);
                graphics.fillCircle(cx, cy + 2 * s, 2 * s);
                break;
        }
    }

    /**
     * Get character metadata for UI display.
     */
    function getInfo(characterId) {
        return CHARACTERS[characterId] || null;
    }

    /**
     * Get all character IDs.
     */
    function getAllIds() {
        return Object.keys(CHARACTERS);
    }

    return { createTexture, createBallTexture, preloadAll, getInfo, getAllIds, CHARACTERS, SVG_PATHS };
})();
