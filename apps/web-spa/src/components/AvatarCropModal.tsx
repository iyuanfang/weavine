import { useCallback, useEffect, useRef, useState } from 'react';

interface AvatarCropModalProps {
  file: File;
  onCancel: () => void;
  onConfirm: (croppedBlob: Blob) => void;
}

const STAGE_SIZE = 460;
const CIRCLE_RADIUS = 150;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const TARGET_SIZE = 256;
const OUTPUT_MIME = 'image/webp';
const OUTPUT_QUALITY = 0.85;

interface ImgSize {
  w: number;
  h: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Default pan: center the (zoomed) image inside the stage. Negative offsets
// are expected when zoomed-in (image overflows the stage edges).
function defaultPan(imgW: number, imgH: number): { x: number; y: number } {
  return { x: (STAGE_SIZE - imgW) / 2, y: (STAGE_SIZE - imgH) / 2 };
}

// Clamp pan so the fixed circle (centered in stage) is always fully covered
// by the image — you can never drag a transparent area into the crop.
function clampPan(
  panX: number,
  panY: number,
  imgW: number,
  imgH: number,
  radius: number,
): { x: number; y: number } {
  const cx = STAGE_SIZE / 2;
  const cy = STAGE_SIZE / 2;
  const minX = Math.max(STAGE_SIZE - imgW, cx + radius - imgW);
  const maxX = Math.min(0, cx - radius);
  const minY = Math.max(STAGE_SIZE - imgH, cy + radius - imgH);
  const maxY = Math.min(0, cy - radius);
  return { x: clamp(panX, minX, maxX), y: clamp(panY, minY, maxY) };
}

// Convert the fixed-stage circle to a source rectangle in image-pixel coords.
function cropSourceRect(
  panX: number,
  panY: number,
  zoom: number,
  radius: number,
  imgSize: ImgSize,
): { sx: number; sy: number; size: number } {
  const cx = STAGE_SIZE / 2;
  const cy = STAGE_SIZE / 2;
  const icx = (cx - panX) / zoom;
  const icy = (cy - panY) / zoom;
  const size = (radius * 2) / zoom;
  const sx = clamp(icx - size / 2, 0, imgSize.w - size);
  const sy = clamp(icy - size / 2, 0, imgSize.h - size);
  return { sx, sy, size };
}

interface DragData {
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
}
interface PinchData {
  d0: number;
  panAtStart: { x: number; y: number };
  z0: number;
}

export function AvatarCropModal({ file, onCancel, onConfirm }: AvatarCropModalProps) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<ImgSize | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragData | null>(null);
  const pinchRef = useRef<PinchData | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef<number>(1);

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

  // Recompute and clamp pan whenever image loads or zoom changes.
  useEffect(() => {
    if (!imgSize) return;
    setPan((current) => {
      const def = defaultPan(imgSize.w * zoom, imgSize.h * zoom);
      const centered = clampPan(def.x, def.y, imgSize.w * zoom, imgSize.h * zoom, CIRCLE_RADIUS);
      if (current === null) return centered;
      return clampPan(current.x, current.y, imgSize.w * zoom, imgSize.h * zoom, CIRCLE_RADIUS);
    });
  }, [imgSize, zoom]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Wheel zoom (image only)
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setZoom((z) => clamp(z * (1 + -e.deltaY * 0.002), MIN_ZOOM, MAX_ZOOM));
  }, []);

  // Pointer drag = pan the image
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPanX: panRef.current?.x ?? 0,
      startPanY: panRef.current?.y ?? 0,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const data = dragRef.current;
    const img = imgRef.current;
    if (!data || !img || img.naturalWidth === 0) return;
    const dx = e.clientX - data.startX;
    const dy = e.clientY - data.startY;
    const z = zoomRef.current;
    setPan(
      clampPan(
        data.startPanX + dx,
        data.startPanY + dy,
        img.naturalWidth * z,
        img.naturalHeight * z,
        CIRCLE_RADIUS,
      ),
    );
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // Touch: 1 finger pans, 2 fingers pinch-zooms around the midpoint
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      dragRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        startPanX: panRef.current?.x ?? 0,
        startPanY: panRef.current?.y ?? 0,
      };
    } else if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      pinchRef.current = {
        d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        panAtStart: panRef.current ?? { x: 0, y: 0 },
        z0: zoomRef.current,
      };
      dragRef.current = null;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const img = imgRef.current;
    if (!img || img.naturalWidth === 0) return;
    if (pinchRef.current && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = d / pinchRef.current.d0;
      const newZoom = clamp(pinchRef.current.z0 * ratio, MIN_ZOOM, MAX_ZOOM);
      // Pinch around the midpoint of the two fingers — keep that stage point
      // over the same image pixel before and after the zoom change.
      const mx = (a.clientX + b.clientX) / 2;
      const my = (a.clientY + b.clientY) / 2;
      const stageRect = e.currentTarget.getBoundingClientRect();
      const stageX = mx - stageRect.left;
      const stageY = my - stageRect.top;
      const z0 = pinchRef.current.z0;
      const pan0 = pinchRef.current.panAtStart;
      const imgPxX = (stageX - pan0.x) / z0;
      const imgPxY = (stageY - pan0.y) / z0;
      setZoom(newZoom);
      setPan(
        clampPan(
          stageX - imgPxX * newZoom,
          stageY - imgPxY * newZoom,
          img.naturalWidth * newZoom,
          img.naturalHeight * newZoom,
          CIRCLE_RADIUS,
        ),
      );
    } else if (dragRef.current && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - dragRef.current.startX;
      const dy = t.clientY - dragRef.current.startY;
      const z = zoomRef.current;
      setPan(
        clampPan(
          dragRef.current.startPanX + dx,
          dragRef.current.startPanY + dy,
          img.naturalWidth * z,
          img.naturalHeight * z,
          CIRCLE_RADIUS,
        ),
      );
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    dragRef.current = null;
    pinchRef.current = null;
  }, []);

  const onZoomSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setZoom(clamp(Number(e.target.value), MIN_ZOOM, MAX_ZOOM));
  }, []);

  const onZoomStep = useCallback((delta: number) => {
    setZoom((z) => clamp(z + delta, MIN_ZOOM, MAX_ZOOM));
  }, []);

  const onReset = useCallback(() => {
    setZoom(1);
    if (imgSize) {
      const def = defaultPan(imgSize.w, imgSize.h);
      setPan(clampPan(def.x, def.y, imgSize.w, imgSize.h, CIRCLE_RADIUS));
    }
  }, [imgSize]);

  const confirm = async () => {
    if (!imgRef.current || !imgSize || !pan) return;
    setBusy(true);
    try {
      const { sx, sy, size } = cropSourceRect(pan.x, pan.y, zoom, CIRCLE_RADIUS, imgSize);
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

  if (!imgSize || !pan) {
    return (
      <div className="modal-backdrop" data-testid="avatar-crop-modal" onClick={onBackdrop}>
        <div className="modal" style={{ width: 420, textAlign: 'center' }}>
          <p style={{ margin: 0 }}>{loadError ?? '正在加载图片…'}</p>
        </div>
      </div>
    );
  }

  const imgW = imgSize.w * zoom;
  const imgH = imgSize.h * zoom;

  return (
    <div className="modal-backdrop" data-testid="avatar-crop-modal" onClick={onBackdrop}>
      <div
        className="modal"
        data-testid="avatar-crop-modal-inner"
        style={{ width: STAGE_SIZE + 48, maxWidth: '94vw', padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 6px 0', fontSize: 'var(--text-lg)' }}>调整头像</h2>
        <p className="text-xs text-muted" style={{ margin: '0 0 14px 0' }}>
          拖动图片调整位置，滚轮或双指捏合缩放。
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
              width: STAGE_SIZE,
              height: STAGE_SIZE,
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 8,
              background: '#0f172a',
              cursor: 'grab',
              touchAction: 'none',
              flexShrink: 0,
            }}
          >
            {/* Dimmed base layer — shows the full image darkened everywhere */}
            <img
              ref={imgRef}
              data-testid="avatar-crop-image"
              src={imgUrl ?? undefined}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: pan.x,
                top: pan.y,
                width: imgW,
                height: imgH,
                pointerEvents: 'none',
                userSelect: 'none',
                filter: 'brightness(0.45)',
              }}
            />
            {/* Full-color circle cutout — same image, masked to the circle */}
            <div
              data-testid="avatar-crop-circle-mask"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: STAGE_SIZE,
                height: STAGE_SIZE,
                pointerEvents: 'none',
                WebkitMaskImage: `radial-gradient(circle ${CIRCLE_RADIUS}px at ${STAGE_SIZE / 2}px ${STAGE_SIZE / 2}px, #000 100%, transparent 100%)`,
                maskImage: `radial-gradient(circle ${CIRCLE_RADIUS}px at ${STAGE_SIZE / 2}px ${STAGE_SIZE / 2}px, #000 100%, transparent 100%)`,
              }}
            >
              <img
                src={imgUrl ?? undefined}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  left: pan.x,
                  top: pan.y,
                  width: imgW,
                  height: imgH,
                  userSelect: 'none',
                }}
              />
            </div>
            {/* Circle border ring */}
            <div
              data-testid="avatar-crop-ring"
              style={{
                position: 'absolute',
                left: STAGE_SIZE / 2 - CIRCLE_RADIUS,
                top: STAGE_SIZE / 2 - CIRCLE_RADIUS,
                width: CIRCLE_RADIUS * 2,
                height: CIRCLE_RADIUS * 2,
                borderRadius: '50%',
                border: '2px solid rgba(255, 255, 255, 0.9)',
                boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.2), 0 0 12px rgba(0, 0, 0, 0.4)',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            margin: '14px 0 18px 0',
            width: STAGE_SIZE,
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
            value={zoom}
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, width: STAGE_SIZE }}>
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
