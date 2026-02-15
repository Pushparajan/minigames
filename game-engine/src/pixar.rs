//! Pixar-style character rendering for STEM Minigames.
//!
//! Provides procedurally generated circle textures, multi-layered sprite
//! characters with big expressive eyes, highlight/shadow layers, and
//! subtle idle animations for a Pixar movie aesthetic.

use bevy::prelude::*;
use bevy::render::render_asset::RenderAssetUsages;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

pub struct PixarPlugin;

impl Plugin for PixarPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, init_pixar_assets);
        app.add_systems(
            Update,
            (animate_breathing, animate_scale_pulse, animate_eye_blink)
                .run_if(in_state(crate::AppState::Playing)),
        );
    }
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

/// Holds procedurally generated shape textures used across all games.
#[derive(Resource, Clone)]
pub struct PixarAssets {
    /// 64x64 anti-aliased white circle — tint via `Sprite::color`.
    pub circle: Handle<Image>,
}

fn init_pixar_assets(mut commands: Commands, mut images: ResMut<Assets<Image>>) {
    let circle = create_circle_texture(&mut images);
    commands.insert_resource(PixarAssets { circle });
}

// ---------------------------------------------------------------------------
// Color palettes  (Pixar-inspired vibrant, saturated tones)
// ---------------------------------------------------------------------------

pub mod palette {
    use bevy::prelude::Color;

    // Heroes
    pub const HERO_BLUE: Color = Color::srgb(0.25, 0.55, 0.95);
    pub const HERO_RED: Color = Color::srgb(0.95, 0.3, 0.25);
    pub const HERO_GREEN: Color = Color::srgb(0.2, 0.8, 0.4);
    pub const HERO_ORANGE: Color = Color::srgb(1.0, 0.6, 0.15);
    pub const HERO_PURPLE: Color = Color::srgb(0.6, 0.3, 0.9);
    pub const HERO_TEAL: Color = Color::srgb(0.2, 0.8, 0.8);
    pub const HERO_YELLOW: Color = Color::srgb(1.0, 0.85, 0.1);

    // Enemies / Villains
    pub const VILLAIN_RED: Color = Color::srgb(0.85, 0.15, 0.1);
    pub const VILLAIN_PURPLE: Color = Color::srgb(0.55, 0.1, 0.7);
    pub const VILLAIN_DARK: Color = Color::srgb(0.3, 0.15, 0.35);
    pub const VILLAIN_GREEN: Color = Color::srgb(0.3, 0.7, 0.1);

    // Objects
    pub const GOLD: Color = Color::srgb(1.0, 0.84, 0.0);
    pub const SILVER: Color = Color::srgb(0.78, 0.82, 0.86);
    pub const BRONZE: Color = Color::srgb(0.8, 0.5, 0.2);
    pub const CANDY_PINK: Color = Color::srgb(1.0, 0.5, 0.7);
    pub const ELECTRIC_CYAN: Color = Color::srgb(0.0, 0.9, 1.0);
    pub const LEAF_GREEN: Color = Color::srgb(0.3, 0.7, 0.15);

    // Environments
    pub const SKY_BLUE: Color = Color::srgb(0.53, 0.81, 0.98);
    pub const GROUND_GREEN: Color = Color::srgb(0.2, 0.55, 0.25);
    pub const GROUND_BROWN: Color = Color::srgb(0.55, 0.35, 0.2);
    pub const NIGHT_BG: Color = Color::srgb(0.04, 0.03, 0.14);
    pub const LAB_BG: Color = Color::srgb(0.08, 0.08, 0.18);

    // Effects
    pub const HIGHLIGHT: Color = Color::srgba(1.0, 1.0, 1.0, 0.3);
    pub const SHADOW: Color = Color::srgba(0.0, 0.0, 0.0, 0.2);
    pub const BLUSH: Color = Color::srgba(1.0, 0.4, 0.5, 0.3);
}

// ---------------------------------------------------------------------------
// Animation components
// ---------------------------------------------------------------------------

/// Subtle scale oscillation — gives characters a "breathing" feel.
#[derive(Component)]
pub struct PixarBreathing {
    pub timer: f32,
}

/// More pronounced scale pulsing for collectibles / glowing objects.
#[derive(Component)]
pub struct ScalePulse {
    pub min_scale: f32,
    pub max_scale: f32,
    pub speed: f32,
    pub timer: f32,
}

/// Periodic eye-blink animation (hides/shows eye child sprites).
#[derive(Component)]
pub struct EyeBlink {
    pub timer: f32,
    pub interval: f32,
    pub blink_dur: f32,
    pub blinking: bool,
}

/// Tag for eye child sprites (sclera, iris, pupil, specular highlight).
#[derive(Component)]
pub struct PixarEye;

// ---------------------------------------------------------------------------
// Character configuration
// ---------------------------------------------------------------------------

/// Describes how to render a Pixar-style character.
pub struct CharacterConfig {
    pub body_color: Color,
    pub body_size: Vec2,
    /// Use circle texture for body (true) or plain rectangle (false).
    pub is_round: bool,
    /// 0.0 = no eyes, 1.0 = big expressive Wall-E eyes.
    pub eye_scale: f32,
    /// Iris color.
    pub eye_color: Color,
    /// Pink cheek circles.
    pub has_blush: bool,
    /// Top-left shine spot + bottom shadow.
    pub has_highlight: bool,
    /// Subtle breathing scale animation.
    pub breathing: bool,
    /// Pulsing scale (for collectibles).
    pub scale_pulse: bool,
}

impl CharacterConfig {
    /// Friendly hero character — round body, big blue eyes, pink cheeks.
    pub fn hero(color: Color, size: Vec2) -> Self {
        Self {
            body_color: color,
            body_size: size,
            is_round: true,
            eye_scale: 1.0,
            eye_color: Color::srgb(0.3, 0.55, 1.0),
            has_blush: true,
            has_highlight: true,
            breathing: true,
            scale_pulse: false,
        }
    }

    /// Antagonist / enemy — round, angry red eyes, no blush.
    pub fn enemy(color: Color, size: Vec2) -> Self {
        Self {
            body_color: color,
            body_size: size,
            is_round: true,
            eye_scale: 0.8,
            eye_color: Color::srgb(1.0, 0.2, 0.1),
            has_blush: false,
            has_highlight: true,
            breathing: true,
            scale_pulse: false,
        }
    }

    /// Collectible item — round, small eyes, pulsing glow.
    pub fn collectible(color: Color, size: f32) -> Self {
        Self {
            body_color: color,
            body_size: Vec2::splat(size),
            is_round: true,
            eye_scale: 0.5,
            eye_color: Color::BLACK,
            has_blush: false,
            has_highlight: true,
            breathing: false,
            scale_pulse: true,
        }
    }

    /// Vehicle / machine — rectangular, friendly windshield-style eyes.
    pub fn vehicle(color: Color, size: Vec2) -> Self {
        Self {
            body_color: color,
            body_size: size,
            is_round: false,
            eye_scale: 0.7,
            eye_color: Color::srgb(0.2, 0.5, 0.9),
            has_blush: false,
            has_highlight: true,
            breathing: false,
            scale_pulse: false,
        }
    }

    /// Robot — boxy body, glowing green eyes.
    pub fn robot(color: Color, size: Vec2) -> Self {
        Self {
            body_color: color,
            body_size: size,
            is_round: false,
            eye_scale: 0.9,
            eye_color: Color::srgb(0.0, 1.0, 0.5),
            has_blush: false,
            has_highlight: true,
            breathing: true,
            scale_pulse: false,
        }
    }

    /// Organic blob — round, cute, blushing.
    pub fn blob(color: Color, size: f32) -> Self {
        Self {
            body_color: color,
            body_size: Vec2::splat(size),
            is_round: true,
            eye_scale: 0.8,
            eye_color: Color::BLACK,
            has_blush: true,
            has_highlight: true,
            breathing: true,
            scale_pulse: false,
        }
    }

    /// Simple prop — no face, no animation.
    pub fn prop(color: Color, size: Vec2, round: bool) -> Self {
        Self {
            body_color: color,
            body_size: size,
            is_round: round,
            eye_scale: 0.0,
            eye_color: Color::BLACK,
            has_blush: false,
            has_highlight: round,
            breathing: false,
            scale_pulse: false,
        }
    }

    /// Bullet / projectile — tiny, round, glowing, no face.
    pub fn projectile(color: Color, size: f32) -> Self {
        Self {
            body_color: color,
            body_size: Vec2::splat(size),
            is_round: true,
            eye_scale: 0.0,
            eye_color: Color::BLACK,
            has_blush: false,
            has_highlight: true,
            breathing: false,
            scale_pulse: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Character spawning
// ---------------------------------------------------------------------------

/// Spawn a multi-layered Pixar-style character.
///
/// Returns the parent `Entity` which owns the body `Sprite` plus all
/// components from `bundle`.  Child entities (eyes, highlights, shadow,
/// blush) are attached automatically and despawn with the parent.
pub fn spawn_character(
    commands: &mut Commands,
    assets: &PixarAssets,
    config: &CharacterConfig,
    position: Vec3,
    bundle: impl Bundle,
) -> Entity {
    let body_sprite = if config.is_round {
        Sprite {
            image: assets.circle.clone(),
            color: config.body_color,
            custom_size: Some(config.body_size),
            ..default()
        }
    } else {
        Sprite {
            color: config.body_color,
            custom_size: Some(config.body_size),
            ..default()
        }
    };

    let bw = config.body_size.x;
    let bh = config.body_size.y;
    let eye_scale = config.eye_scale;
    let eye_color = config.eye_color;
    let has_highlight = config.has_highlight;
    let has_blush = config.has_blush;
    let is_round = config.is_round;
    let circle = assets.circle.clone();

    let mut ec = commands.spawn((body_sprite, Transform::from_translation(position), bundle));

    ec.with_children(|parent| {
        // -- Highlight (top-left shine) ------------------------------------
        if has_highlight {
            let hl_size = Vec2::new(bw * 0.3, bh * 0.25);
            let sprite = if is_round {
                Sprite {
                    image: circle.clone(),
                    color: palette::HIGHLIGHT,
                    custom_size: Some(hl_size),
                    ..default()
                }
            } else {
                Sprite {
                    color: palette::HIGHLIGHT,
                    custom_size: Some(hl_size),
                    ..default()
                }
            };
            parent.spawn((sprite, Transform::from_xyz(-bw * 0.15, bh * 0.18, 0.05)));
        }

        // -- Shadow (under body) -------------------------------------------
        if has_highlight {
            parent.spawn((
                Sprite {
                    image: circle.clone(),
                    color: palette::SHADOW,
                    custom_size: Some(Vec2::new(bw * 0.8, bh * 0.12)),
                    ..default()
                },
                Transform::from_xyz(0.0, -bh * 0.55, -0.05),
            ));
        }

        // -- Eyes ----------------------------------------------------------
        if eye_scale > 0.0 {
            let eye_r = bw.min(bh) * 0.28 * eye_scale;
            let iris_r = eye_r * 0.6;
            let pupil_r = eye_r * 0.3;
            let hl_r = eye_r * 0.15;
            let ey = bh * 0.1;
            let spread = bw * 0.22;

            for side in [-1.0_f32, 1.0] {
                let ex = side * spread;
                // Sclera (white)
                parent.spawn((
                    Sprite {
                        image: circle.clone(),
                        color: Color::WHITE,
                        custom_size: Some(Vec2::splat(eye_r)),
                        ..default()
                    },
                    Transform::from_xyz(ex, ey, 0.1),
                    PixarEye,
                ));
                // Iris (colored)
                parent.spawn((
                    Sprite {
                        image: circle.clone(),
                        color: eye_color,
                        custom_size: Some(Vec2::splat(iris_r)),
                        ..default()
                    },
                    Transform::from_xyz(ex, ey - eye_r * 0.05, 0.15),
                    PixarEye,
                ));
                // Pupil (black)
                parent.spawn((
                    Sprite {
                        image: circle.clone(),
                        color: Color::BLACK,
                        custom_size: Some(Vec2::splat(pupil_r)),
                        ..default()
                    },
                    Transform::from_xyz(ex, ey - eye_r * 0.08, 0.2),
                    PixarEye,
                ));
                // Specular highlight (white dot)
                parent.spawn((
                    Sprite {
                        image: circle.clone(),
                        color: Color::WHITE,
                        custom_size: Some(Vec2::splat(hl_r)),
                        ..default()
                    },
                    Transform::from_xyz(ex + eye_r * 0.12, ey + eye_r * 0.12, 0.25),
                    PixarEye,
                ));
            }
        }

        // -- Blush (pink cheeks) -------------------------------------------
        if has_blush {
            let blush_r = bw * 0.18;
            for side in [-1.0_f32, 1.0] {
                parent.spawn((
                    Sprite {
                        image: circle.clone(),
                        color: palette::BLUSH,
                        custom_size: Some(Vec2::splat(blush_r)),
                        ..default()
                    },
                    Transform::from_xyz(side * bw * 0.3, -bh * 0.05, 0.08),
                ));
            }
        }
    });

    let entity = ec.id();

    // -- Attach animation components ----------------------------------------
    if config.breathing {
        commands
            .entity(entity)
            .insert(PixarBreathing { timer: 0.0 });
    }
    if config.scale_pulse {
        commands.entity(entity).insert(ScalePulse {
            min_scale: 0.92,
            max_scale: 1.08,
            speed: 3.5,
            timer: 0.0,
        });
    }
    if config.eye_scale > 0.0 {
        commands.entity(entity).insert(EyeBlink {
            timer: 0.0,
            interval: 3.5,
            blink_dur: 0.12,
            blinking: false,
        });
    }

    entity
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/// Create a round `Sprite` using the circle texture (no eyes/face).
///
/// Perfect for obstacles, platforms, bullets, molecules, orbs, etc.
pub fn round_sprite(assets: &PixarAssets, color: Color, size: Vec2) -> Sprite {
    Sprite {
        image: assets.circle.clone(),
        color,
        custom_size: Some(size),
        ..default()
    }
}

// ---------------------------------------------------------------------------
// Animation systems  (registered by PixarPlugin, run during Playing state)
// ---------------------------------------------------------------------------

fn animate_breathing(time: Res<Time>, mut q: Query<(&mut Transform, &mut PixarBreathing)>) {
    let dt = time.delta_secs();
    for (mut tf, mut b) in &mut q {
        b.timer += dt * 2.5;
        let s = b.timer.sin() * 0.02;
        tf.scale.x = 1.0 + s;
        tf.scale.y = 1.0 - s;
    }
}

fn animate_scale_pulse(time: Res<Time>, mut q: Query<(&mut Transform, &mut ScalePulse)>) {
    let dt = time.delta_secs();
    for (mut tf, mut p) in &mut q {
        p.timer += dt;
        let t = (p.timer * p.speed).sin() * 0.5 + 0.5;
        let scale = p.min_scale + t * (p.max_scale - p.min_scale);
        tf.scale = Vec3::splat(scale);
    }
}

fn animate_eye_blink(
    time: Res<Time>,
    mut blinkers: Query<(&mut EyeBlink, &Children)>,
    mut vis_q: Query<&mut Visibility, With<PixarEye>>,
) {
    let dt = time.delta_secs();
    for (mut blink, children) in &mut blinkers {
        blink.timer += dt;

        let show = if blink.blinking {
            if blink.timer > blink.blink_dur {
                blink.blinking = false;
                blink.timer = 0.0;
                true
            } else {
                false
            }
        } else if blink.timer > blink.interval {
            blink.blinking = true;
            blink.timer = 0.0;
            false
        } else {
            true
        };

        let vis = if show {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
        for &child in children.iter() {
            if let Ok(mut v) = vis_q.get_mut(child) {
                *v = vis;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Procedural texture generation
// ---------------------------------------------------------------------------

/// Create a 64x64 anti-aliased white circle texture.
///
/// The white color is tinted at draw time by `Sprite::color`, so one
/// texture serves all characters with any body color.
fn create_circle_texture(images: &mut Assets<Image>) -> Handle<Image> {
    let size: u32 = 64;
    let mut data = vec![0u8; (size * size * 4) as usize];
    let center = size as f32 / 2.0;
    let radius = center - 1.0;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - center + 0.5;
            let dy = y as f32 - center + 0.5;
            let dist = (dx * dx + dy * dy).sqrt();
            let idx = ((y * size + x) * 4) as usize;

            if dist <= radius {
                let alpha = if dist > radius - 1.5 {
                    ((radius - dist) / 1.5 * 255.0) as u8
                } else {
                    255
                };
                data[idx] = 255;
                data[idx + 1] = 255;
                data[idx + 2] = 255;
                data[idx + 3] = alpha;
            }
        }
    }

    images.add(Image::new(
        Extent3d {
            width: size,
            height: size,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        data,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD,
    ))
}
