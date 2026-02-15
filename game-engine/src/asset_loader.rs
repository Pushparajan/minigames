//! Custom asset upload bridge — allows the React shell to upload
//! PNG/JPG sprite images and .glb/.gltf 3-D models at runtime.
//!
//! **Image uploads** are decoded and stored as `Handle<Image>` in
//! [`CustomAssets`].  Games check this resource and use the custom sprite
//! in place of the default procedural circle texture.
//!
//! **glTF uploads** are stored as raw bytes.  A helper function creates a
//! browser Blob URL that Bevy's asset server can `load()`.

use bevy::prelude::*;
use bevy::render::render_asset::RenderAssetUsages;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use std::collections::HashMap;
use std::sync::Mutex;
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

pub struct AssetLoaderPlugin;

impl Plugin for AssetLoaderPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<CustomAssets>();
        app.add_systems(Update, process_uploads);
    }
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

/// Holds custom assets uploaded by the player at runtime.
#[derive(Resource, Default)]
pub struct CustomAssets {
    /// Character sprite overrides keyed by role (e.g. `"hero"`, `"enemy"`).
    pub sprites: HashMap<String, Handle<Image>>,
    /// Optional custom background image.
    pub background: Option<Handle<Image>>,
    /// Raw .glb bytes keyed by model name — call [`gltf_blob_url`] to get
    /// a URL that Bevy can load.
    pub gltf_data: HashMap<String, Vec<u8>>,
    /// Blob URLs created for uploaded .glb files.
    pub gltf_urls: HashMap<String, String>,
}

// ---------------------------------------------------------------------------
// Pending upload queue  (written from wasm-bindgen exports, read by Bevy)
// ---------------------------------------------------------------------------

struct PendingUpload {
    role: String,
    kind: UploadKind,
    data: Vec<u8>,
    width: u32,
    height: u32,
}

enum UploadKind {
    Sprite,
    Background,
    Gltf,
}

static PENDING_UPLOADS: Mutex<Vec<PendingUpload>> = Mutex::new(Vec::new());

// ---------------------------------------------------------------------------
// wasm-bindgen exports  (called from JavaScript / React)
// ---------------------------------------------------------------------------

/// Upload an RGBA sprite image for a given character role.
///
/// `role` — e.g. `"hero"`, `"enemy"`, `"collectible"`.
/// `width`, `height` — image dimensions.
/// `rgba` — raw pixel data, 4 bytes per pixel (RGBA order).
#[wasm_bindgen]
pub fn upload_sprite(role: &str, width: u32, height: u32, rgba: &[u8]) {
    if let Ok(mut q) = PENDING_UPLOADS.lock() {
        q.push(PendingUpload {
            role: role.to_string(),
            kind: UploadKind::Sprite,
            data: rgba.to_vec(),
            width,
            height,
        });
    }
}

/// Upload an RGBA image to use as the game background.
#[wasm_bindgen]
pub fn upload_background(width: u32, height: u32, rgba: &[u8]) {
    if let Ok(mut q) = PENDING_UPLOADS.lock() {
        q.push(PendingUpload {
            role: "background".to_string(),
            kind: UploadKind::Background,
            data: rgba.to_vec(),
            width,
            height,
        });
    }
}

/// Upload a .glb (binary glTF) file.
///
/// The bytes are stored and a browser Blob URL is created so that Bevy's
/// asset server can load the model:
///
/// ```ignore
/// let url = custom_assets.gltf_urls.get("my_model").unwrap();
/// let scene: Handle<Scene> = asset_server.load(url);
/// ```
#[wasm_bindgen]
pub fn upload_gltf(name: &str, data: &[u8]) {
    if let Ok(mut q) = PENDING_UPLOADS.lock() {
        q.push(PendingUpload {
            role: name.to_string(),
            kind: UploadKind::Gltf,
            data: data.to_vec(),
            width: 0,
            height: 0,
        });
    }
}

// ---------------------------------------------------------------------------
// Bevy system — drains the queue and creates Bevy assets
// ---------------------------------------------------------------------------

fn process_uploads(mut custom: ResMut<CustomAssets>, mut images: ResMut<Assets<Image>>) {
    let uploads: Vec<PendingUpload> = match PENDING_UPLOADS.lock() {
        Ok(mut q) => q.drain(..).collect(),
        Err(_) => return,
    };

    for up in uploads {
        match up.kind {
            UploadKind::Sprite => {
                if up.data.len() == (up.width * up.height * 4) as usize {
                    let image = Image::new(
                        Extent3d {
                            width: up.width,
                            height: up.height,
                            depth_or_array_layers: 1,
                        },
                        TextureDimension::D2,
                        up.data,
                        TextureFormat::Rgba8UnormSrgb,
                        RenderAssetUsages::RENDER_WORLD,
                    );
                    let handle = images.add(image);
                    custom.sprites.insert(up.role, handle);
                }
            }
            UploadKind::Background => {
                if up.data.len() == (up.width * up.height * 4) as usize {
                    let image = Image::new(
                        Extent3d {
                            width: up.width,
                            height: up.height,
                            depth_or_array_layers: 1,
                        },
                        TextureDimension::D2,
                        up.data,
                        TextureFormat::Rgba8UnormSrgb,
                        RenderAssetUsages::RENDER_WORLD,
                    );
                    let handle = images.add(image);
                    custom.background = Some(handle);
                }
            }
            UploadKind::Gltf => {
                // Create a browser Blob URL so Bevy can fetch it later.
                if let Some(url) = create_blob_url(&up.data, "model/gltf-binary") {
                    custom.gltf_urls.insert(up.role.clone(), url);
                }
                custom.gltf_data.insert(up.role, up.data);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Create a Blob URL from raw bytes using web-sys.
fn create_blob_url(data: &[u8], mime: &str) -> Option<String> {
    let uint8 = js_sys::Uint8Array::from(data);
    let parts = js_sys::Array::new();
    parts.push(&uint8.buffer());
    let mut opts = web_sys::BlobPropertyBag::new();
    opts.type_(mime);
    let blob = web_sys::Blob::new_with_buffer_source_sequence_and_options(&parts, &opts).ok()?;
    web_sys::Url::create_object_url_with_blob(&blob).ok()
}
