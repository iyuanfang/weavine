import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface AvatarCropModalProps {
  file: File;
  onCancel: () => void;
  onConfirm: (croppedBlob: Blob) => void;
}

const STAGE_MAX = 360;
const MIN_RING = 80;
const MAX_RING = 320;
const TARGET_SIZE = 256;
const OUTPUT_MIME = 'image/webp';
const OUTPUT_QUALITY = 0.85;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const PREVIEW_SIZES = [88, 40, 32] as const;

interface CropState {
  zoom: number;
  cx: number;
  cy: number;
}

interface ImgSize {
  w: number;
  h: number;
}

interface StageGeom {
  stageW: number;
  stageH: number;
  dw: number;
  dh: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function computeGeom(imgSize: ImgSize, zoom: number): StageGeom {
  const s1 = STAGE_MAX / Math.max(imgSize.w, imgSize.h);
  const stageW = Math.round(imgSize.w * s1);
  const stageH = Math.round(imgSize.h * s1);
  const scale = s1 * zoom;
  const dw = imgSize.w * scale;
  const dh = imgSize.h * scale;
  return { stageW, stageH, dw, dh };
}

function ringForGeom(geom: StageGeom): number {
  return Math.min(MAX_RING, Math.max(MIN_RING, Math.min(geom.dw, geom.dh)));
}

function defaultCrop(geom: StageGeom): CropState {
  return { zoom: 1, cx: geom.stageW / 2, cy: geom.stageH / 2 };
}

function clampCenter(
  cx: number,
  cy: number,
  geom: StageGeom,
  ring: number,
): { cx: number; cy: number } {
  const { stageW, stageH, dw, dh } = geom;
  const imgLeft = (stageW - dw) / 2;
  const imgTop = (stageH - dh) / 2;
  const imgRight = imgLeft + dw;
  const imgBottom = imgTop + dh;
  const ringHalf = ring / 2;
  let loX: number; let hiX: number; let loY: number; let hiY: number;
  if (ring > stageW) {
    loX = (stageW - ring) / 2;
    hiX = (stageW + ring) / 2;
  } else {
    loX = Math.max(imgLeft + ringHalf, ringHalf);
    hiX = Math.min(imgRight - ringHalf, stageW - ringHalf);
  }
  if (ring > stageH) {
    loY = (stageH - ring) / 2;
    hiY = (stageH + ring) / 2;
  } else {
    loY = Math.max(imgTop + ringHalf, ringHalf);
    hiY = Math.min(imgBottom - ringHalf, stageH - ringHalf);
  }
  return { cx: clamp(cx, loX, hiX), cy: clamp(cy, loY, hiY) };
}

function cropSourceRect(
  crop: CropState,
  geom: StageGeom,
  ring: number,
  imgSize: ImgSize,
): { sx: number; sy: number; size: number } {
  const { dw, dh, stageW, stageH } = geom;
  if (dw <= 0 || imgSize.w <= 0) return { sx: 0, sy: 0, size: 1 };
  const pxPerImgPx = dw / imgSize.w;
  const icx = (crop.cx - (stageW - dw) / 2) / pxPerImgPx;
  const icy = (crop.cy - (stageH - dh) / 2) / pxPerImgPx;
  const size = ring / pxPerImgPx;
  const sx = clamp(icx - size / 2, 0, imgSize.w - size);
  const sy = clamp(icy - size / 2, 0, imgSize.h - size);
  return { sx, sy, size };
}

interface DragData {
  startX: number;
  startY: number;
  startCrop: CropState;
}

export function AvatarCropModal({ file, onCancel, onConfirm }: AvatarCropModalProps) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<ImgSize | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropState | null>(null);
  const [busy, setBusy] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const geomRef = useRef<StageGeom | null>(null);
  const ringRef = useRef<number>(0);
  const cropRef = useRef<CropState | null>(null);
  const pinchRef = useRef<{ d0: number; z0: number } | null>(null);
  const dragRef = useRef<DragData | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const probe = new Image();
    probe.onload = () => {
      setImgSize({ w: probe.naturalWidth, h: probe.naturalHeight });
      setLoadError(null);
    };
    probe.onerror = () => setLoadError('图片读取失败，请换一张 JPG/PNG/WebP 试试');
    probe.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    cropRef.current = crop;
  }, [crop]);

  const geom = useMemo<StageGeom | null>(() => {
    if (!imgSize) return null;
    return computeGeom(imgSize, crop?.zoom ?? 1);
  }, [imgSize, crop?.zoom]);

  const ring = useMemo(() => (geom ? ringForGeom(geom) : 0), [geom]);

  useEffect(() => {
    geomRef.current = geom;
  }, [geom]);
  useEffect(() => {
    ringRef.current = ring;
  }, [ring]);

  useEffect(() => {
    if (!geom || !imgSize) return;
    setCrop((c) => {
      if (c === null) return defaultCrop(geom);
      const clamped = clampCenter(c.cx, c.cy, geom, ring);
      if (clamped.cx === c.cx && clamped.cy === c.cy) return c;
      return { ...c, ...clamped };
    });
  }, [geom, ring, imgSize]);

  useEffect(() => {
    if (!geom || ring <= 0 || !crop || !imgSize) return;
    const canvases = Array.from(
      document.querySelectorAll<HTMLCanvasElement>('[data-testid^="avatar-crop-preview-"]'),
    );
    const drawOne = (canvas: HTMLCanvasElement, destSize: number) => {
      const img = imgRef.current;
      if (!img || !img.complete || img.naturalWidth === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(destSize * dpr));
      canvas.height = Math.max(1, Math.round(destSize * dpr));
      canvas.style.width = `${destSize}px`;
      canvas.style.height = `${destSize}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, destSize, destSize);
      ctx.save();
      ctx.beginPath();
      ctx.arc(destSize / 2, destSize / 2, destSize / 2, 0, Math.PI * 2);
      ctx.clip();
      const { sx, sy, size } = cropSourceRect(crop, geom, ring, imgSize);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, size, size, 0, 0, destSize, destSize);
      ctx.restore();
    };
    for (const canvas of canvases) {
      const m = canvas.dataset.testid?.match(/avatar-crop-preview-(\d+)/);
      if (!m) continue;
      const size = Number(m[1]);
      if (PREVIEW_SIZES.includes(size as (typeof PREVIEW_SIZES)[number])) drawOne(canvas, size);
    }
  }, [crop, ring, geom, imgSize]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setCrop((c) => {
      if (!c) return c;
      const factor = 1 + -e.deltaY * 0.002;
      return { ...c, zoom: clamp(c.zoom * factor, MIN_ZOOM, MAX_ZOOM) };
    });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      startCrop: cropRef.current ?? { zoom: 1, cx: 0, cy: 0 },
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const data = dragRef.current;
    const g = geomRef.current;
    const r = ringRef.current;
    if (!data || !g || r <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setCrop((c) => {
      if (!c) return c;
      const next = {
        ...c,
        cx: data.startCrop.cx + (x - data.startX),
        cy: data.startCrop.cy + (y - data.startY),
      };
      return { ...next, ...clampCenter(next.cx, next.cy, g, r) };
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    pinchRef.current = {
      d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      z0: cropRef.current?.zoom ?? 1,
    };
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!pinchRef.current || e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const ratio = d / pinchRef.current.d0;
    const nextZoom = clamp(pinchRef.current.z0 * ratio, MIN_ZOOM, MAX_ZOOM);
    setCrop((c) => (c ? { ...c, zoom: nextZoom } : c));
  }, []);

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  const onZoomSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const z = Number(e.target.value);
    setCrop((c) => (c ? { ...c, zoom: clamp(z, MIN_ZOOM, MAX_ZOOM) } : c));
  }, []);

  const onZoomStep = useCallback((delta: number) => {
    setCrop((c) => (c ? { ...c, zoom: clamp(c.zoom + delta, MIN_ZOOM, MAX_ZOOM) } : c));
  }, []);

  const onReset = useCallback(() => {
    if (!geom) return;
    setCrop(defaultCrop(geom));
  }, [geom]);

  const confirm = async () => {
    if (!imgRef.current || !imgSize || !geom || ring <= 0 || !crop) return;
    setBusy(true);
    try {
      const { sx, sy, size } = cropSourceRect(crop, geom, ring, imgSize);
      const canvas = document.createElement('canvas');
      canvas.width = TARGET_SIZE;
      canvas.height = TARGET_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 2d unavailable');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imgRef.current, sx, sy, size, size, 0, 0, TARGET_SIZE, TARGET_SIZE);
      let blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), OUTPUT_MIME, OUTPUT_QUALITY),
      );
      if (!blob) {
        blob = await new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/png'),
        );
      }
      if (!blob) {
        setLoadError('图片处理失败，请换一张 JPG/PNG/WebP 图片重试');
        return;
      }
      onConfirm(blob);
    } finally {
      setBusy(false);
    }
  };

  const onBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel],
  );

  if (!imgSize || !geom || !crop) {
    return (
      <div className="modal-backdrop" data-testid="avatar-crop-modal" onClick={onBackdrop}>
        <div className="modal" style={{ width: 420, textAlign: 'center' }}>
          <p style={{ margin: 0 }}>{loadError ?? '正在加载图片…'}</p>
        </div>
      </div>
    );
  }

  const ringRadius = ring / 2;
  const maskImage = `radial-gradient(circle ${ringRadius}px at ${crop.cx}px ${crop.cy}px, #000 100%, transparent 100%)`;

  return (
    <div className="modal-backdrop" data-testid="avatar-crop-modal" onClick={onBackdrop}>
      <div
        className="modal"
        data-testid="avatar-crop-modal-inner"
        style={{ width: 580, maxWidth: '92vw', padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 6px 0', fontSize: 'var(--text-lg)' }}>调整头像</h2>
        <p className="text-xs text-muted" style={{ margin: '0 0 14px 0' }}>
          拖动调整位置，滚轮或双指捏合缩放；右侧预览为最终效果。
        </p>

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div
            data-testid="avatar-crop-stage"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={{
              width: geom.stageW,
              height: geom.stageH,
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 8,
              background: '#0f172a',
              cursor: 'move',
              touchAction: 'none',
              flexShrink: 0,
              WebkitMaskImage: maskImage,
              maskImage,
            }}
          >
            <img
              ref={imgRef}
              data-testid="avatar-crop-image"
              src={imgUrl ?? undefined}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: (geom.stageW - geom.dw) / 2,
                top: (geom.stageH - geom.dh) / 2,
                width: geom.dw,
                height: geom.dh,
                pointerEvents: 'none',
                userSelect: 'none',
                filter: 'brightness(0.5)',
              }}
            />
          </div>

          <div
            data-testid="avatar-crop-previews"
            style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}
          >
            {PREVIEW_SIZES.map((size) => (
              <div
                key={size}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
              >
                <canvas
                  data-testid={`avatar-crop-preview-${size}`}
                  style={{ borderRadius: '50%', background: '#0f172a' }}
                />
                <span className="text-xs text-muted">{size}px</span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            margin: '14px 0 18px 0',
          }}
        >
          <button
            type="button"
            data-testid="avatar-zoom-decrease"
            className="button-secondary"
            onClick={() => onZoomStep(-0.1)}
            aria-label="缩小"
            style={{ width: 32, height: 32, padding: 0 }}
          >
            −
          </button>
          <input
            data-testid="avatar-zoom-slider"
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={onZoomSlider}
            style={{ flex: 1, accentColor: 'var(--color-accent, #6366f1)' }}
          />
          <button
            type="button"
            data-testid="avatar-zoom-increase"
            className="button-secondary"
            onClick={() => onZoomStep(0.1)}
            aria-label="放大"
            style={{ width: 32, height: 32, padding: 0 }}
          >
            +
          </button>
          <button
            type="button"
            data-testid="avatar-zoom-reset"
            className="button-secondary"
            onClick={onReset}
            style={{ padding: '6px 12px' }}
          >
            重置
          </button>
        </div>

        {loadError && (
          <p className="text-xs" style={{ color: 'var(--color-danger, #dc2626)', margin: '0 0 12px 0' }}>
            {loadError}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            className="button-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            data-testid="avatar-crop-confirm"
            className="button-primary"
            onClick={confirm}
            disabled={busy}
          >
            {busy ? '处理中…' : '保存头像'}
          </button>
        </div>
      </div>
    </div>
  );
}
