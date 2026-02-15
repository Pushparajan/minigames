import { useState, useRef, useCallback, type ChangeEvent } from "react";

/* ============================================
   AssetUploader — Collapsible panel for uploading
   character sprites, backgrounds, and 3D models
   to the Bevy WASM game engine
   ============================================ */

declare global {
  interface Window {
    upload_sprite?: (role: string, width: number, height: number, rgba: Uint8Array) => void;
    upload_background?: (width: number, height: number, rgba: Uint8Array) => void;
    upload_gltf?: (name: string, data: Uint8Array) => void;
  }
}

type UploadStatus = "idle" | "uploading" | "success" | "error";

const ROLES = ["hero", "enemy", "collectible", "background"] as const;
type SpriteRole = (typeof ROLES)[number];

/* ---------- Inline styles (dark gaming theme) ---------- */

const styles = {
  wrapper: {
    position: "fixed" as const,
    top: 60,
    right: 16,
    zIndex: 900,
    fontFamily: "system-ui, Avenir, Helvetica, Arial, sans-serif",
  },

  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    color: "#c8c8e0",
    background: "#1e1e2e",
    border: "1px solid #3a3a5c",
    borderRadius: 8,
    cursor: "pointer",
    transition: "border-color 0.25s, background 0.25s",
    userSelect: "none" as const,
  },

  panel: {
    marginTop: 6,
    width: 320,
    maxHeight: "calc(100vh - 120px)",
    overflowY: "auto" as const,
    background: "#1a1a2e",
    border: "1px solid #2a2a4a",
    borderRadius: 10,
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.55)",
    padding: "16px 18px 18px",
  },

  sectionTitle: {
    margin: "0 0 10px",
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: "#8888bb",
  },

  section: {
    marginBottom: 18,
    paddingBottom: 16,
    borderBottom: "1px solid #2a2a4a",
  },

  sectionLast: {
    marginBottom: 0,
    paddingBottom: 0,
    borderBottom: "none",
  },

  label: {
    display: "block",
    marginBottom: 6,
    fontSize: 12,
    color: "#9999bb",
  },

  select: {
    width: "100%",
    padding: "7px 10px",
    fontSize: 13,
    color: "#d0d0e8",
    background: "#14142a",
    border: "1px solid #3a3a5c",
    borderRadius: 6,
    marginBottom: 10,
    outline: "none",
    appearance: "auto" as const,
  },

  textInput: {
    width: "100%",
    padding: "7px 10px",
    fontSize: 13,
    color: "#d0d0e8",
    background: "#14142a",
    border: "1px solid #3a3a5c",
    borderRadius: 6,
    marginBottom: 10,
    outline: "none",
    boxSizing: "border-box" as const,
  },

  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },

  fileBtn: {
    flexShrink: 0,
    padding: "7px 14px",
    fontSize: 12,
    fontWeight: 600,
    color: "#e0e0ff",
    background: "#2c2c50",
    border: "1px solid #4a4a7a",
    borderRadius: 6,
    cursor: "pointer",
    transition: "background 0.2s",
    whiteSpace: "nowrap" as const,
  },

  fileName: {
    flex: 1,
    fontSize: 12,
    color: "#7777aa",
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },

  status: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: 500,
  },

  preview: {
    marginTop: 10,
    maxWidth: "100%",
    maxHeight: 120,
    borderRadius: 6,
    border: "1px solid #2a2a4a",
    objectFit: "contain" as const,
    background: "#12121e",
  },
} as const;

function statusColor(status: UploadStatus): string {
  switch (status) {
    case "uploading":
      return "#e0c040";
    case "success":
      return "#40d080";
    case "error":
      return "#e05050";
    default:
      return "#666688";
  }
}

function statusText(status: UploadStatus, label: string): string {
  switch (status) {
    case "uploading":
      return `Uploading ${label}...`;
    case "success":
      return `${label} uploaded successfully`;
    case "error":
      return `Failed to upload ${label}`;
    default:
      return "";
  }
}

/* ---------- Helper: load image file to RGBA data ---------- */

function imageToRGBA(
  file: File,
): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not create canvas 2D context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      URL.revokeObjectURL(url);
      resolve({
        width: img.width,
        height: img.height,
        rgba: new Uint8Array(imageData.data.buffer),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

/* ---------- Component ---------- */

export default function AssetUploader() {
  const [open, setOpen] = useState(false);

  // Sprite state
  const [spriteRole, setSpriteRole] = useState<SpriteRole>("hero");
  const [spriteFile, setSpriteFile] = useState<File | null>(null);
  const [spritePreview, setSpritePreview] = useState<string | null>(null);
  const [spriteStatus, setSpriteStatus] = useState<UploadStatus>("idle");
  const spriteInputRef = useRef<HTMLInputElement>(null);

  // Background state
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [bgStatus, setBgStatus] = useState<UploadStatus>("idle");
  const bgInputRef = useRef<HTMLInputElement>(null);

  // 3D model state
  const [modelName, setModelName] = useState("");
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [modelStatus, setModelStatus] = useState<UploadStatus>("idle");
  const modelInputRef = useRef<HTMLInputElement>(null);

  /* ---- Sprite upload ---- */

  const handleSpriteSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setSpriteFile(file);
      setSpriteStatus("idle");

      // Preview
      const previewUrl = URL.createObjectURL(file);
      setSpritePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return previewUrl;
      });

      // Upload immediately
      setSpriteStatus("uploading");
      try {
        if (spriteRole === "background") {
          if (!window.upload_background) {
            throw new Error("upload_background not available");
          }
          const { width, height, rgba } = await imageToRGBA(file);
          window.upload_background(width, height, rgba);
        } else {
          if (!window.upload_sprite) {
            throw new Error("upload_sprite not available");
          }
          const { width, height, rgba } = await imageToRGBA(file);
          window.upload_sprite(spriteRole, width, height, rgba);
        }
        setSpriteStatus("success");
      } catch (err) {
        console.error("Sprite upload failed:", err);
        setSpriteStatus("error");
      }
    },
    [spriteRole],
  );

  /* ---- Background upload ---- */

  const handleBgSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setBgFile(file);
      setBgStatus("idle");

      const previewUrl = URL.createObjectURL(file);
      setBgPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return previewUrl;
      });

      setBgStatus("uploading");
      try {
        if (!window.upload_background) {
          throw new Error("upload_background not available");
        }
        const { width, height, rgba } = await imageToRGBA(file);
        window.upload_background(width, height, rgba);
        setBgStatus("success");
      } catch (err) {
        console.error("Background upload failed:", err);
        setBgStatus("error");
      }
    },
    [],
  );

  /* ---- 3D model upload ---- */

  const handleModelSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setModelFile(file);
      setModelStatus("idle");

      const name = modelName.trim() || file.name.replace(/\.(glb|gltf)$/i, "");

      setModelStatus("uploading");
      try {
        if (!window.upload_gltf) {
          throw new Error("upload_gltf not available");
        }
        const buffer = await file.arrayBuffer();
        window.upload_gltf(name, new Uint8Array(buffer));
        setModelStatus("success");
      } catch (err) {
        console.error("Model upload failed:", err);
        setModelStatus("error");
      }
    },
    [modelName],
  );

  return (
    <div style={styles.wrapper}>
      {/* Toggle button */}
      <button
        type="button"
        style={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="asset-uploader-panel"
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "#646cff";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "#3a3a5c";
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        Assets {open ? "\u25B4" : "\u25BE"}
      </button>

      {/* Collapsible panel */}
      {open && (
        <div
          id="asset-uploader-panel"
          style={styles.panel}
          role="region"
          aria-label="Asset uploader"
        >
          {/* ---- Character Sprites ---- */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Character Sprites</h3>

            <label htmlFor="sprite-role" style={styles.label}>
              Role
            </label>
            <select
              id="sprite-role"
              style={styles.select}
              value={spriteRole}
              onChange={(e) => setSpriteRole(e.target.value as SpriteRole)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>

            <input
              ref={spriteInputRef}
              type="file"
              accept="image/png,image/jpeg"
              style={{ display: "none" }}
              onChange={handleSpriteSelect}
            />

            <div style={styles.fileRow}>
              <button
                type="button"
                style={styles.fileBtn}
                onClick={() => spriteInputRef.current?.click()}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#3c3c6a";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#2c2c50";
                }}
              >
                Choose Image
              </button>
              <span style={styles.fileName}>
                {spriteFile?.name ?? "No file selected"}
              </span>
            </div>

            {spritePreview && (
              <img
                src={spritePreview}
                alt="Sprite preview"
                style={styles.preview}
              />
            )}

            {spriteStatus !== "idle" && (
              <div
                style={{ ...styles.status, color: statusColor(spriteStatus) }}
                role="status"
                aria-live="polite"
              >
                {statusText(spriteStatus, "sprite")}
              </div>
            )}
          </div>

          {/* ---- Background ---- */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Background</h3>

            <input
              ref={bgInputRef}
              type="file"
              accept="image/png,image/jpeg"
              style={{ display: "none" }}
              onChange={handleBgSelect}
            />

            <div style={styles.fileRow}>
              <button
                type="button"
                style={styles.fileBtn}
                onClick={() => bgInputRef.current?.click()}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#3c3c6a";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#2c2c50";
                }}
              >
                Choose Image
              </button>
              <span style={styles.fileName}>
                {bgFile?.name ?? "No file selected"}
              </span>
            </div>

            {bgPreview && (
              <img
                src={bgPreview}
                alt="Background preview"
                style={styles.preview}
              />
            )}

            {bgStatus !== "idle" && (
              <div
                style={{ ...styles.status, color: statusColor(bgStatus) }}
                role="status"
                aria-live="polite"
              >
                {statusText(bgStatus, "background")}
              </div>
            )}
          </div>

          {/* ---- 3D Models ---- */}
          <div style={{ ...styles.section, ...styles.sectionLast }}>
            <h3 style={styles.sectionTitle}>3D Models</h3>

            <label htmlFor="model-name" style={styles.label}>
              Model Name (optional)
            </label>
            <input
              id="model-name"
              type="text"
              placeholder="e.g. spaceship"
              style={styles.textInput}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />

            <input
              ref={modelInputRef}
              type="file"
              accept=".glb,.gltf"
              style={{ display: "none" }}
              onChange={handleModelSelect}
            />

            <div style={styles.fileRow}>
              <button
                type="button"
                style={styles.fileBtn}
                onClick={() => modelInputRef.current?.click()}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#3c3c6a";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#2c2c50";
                }}
              >
                Choose File
              </button>
              <span style={styles.fileName}>
                {modelFile?.name ?? "No file selected"}
              </span>
            </div>

            {modelStatus !== "idle" && (
              <div
                style={{ ...styles.status, color: statusColor(modelStatus) }}
                role="status"
                aria-live="polite"
              >
                {statusText(modelStatus, "model")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
