import { useEffect, useRef, useState } from 'react';

interface AvatarCropModalProps {
  file: File;
  onCancel: () => void;
  onConfirm: (croppedBlob: Blob) => void;
}

const TARGET_SIZE = 256;
const OUTPUT_MIME = 'image/webp';
const OUTPUT_QUALITY = 0.85;

export function AvatarCropModal({ file, onCancel, onConfirm }: AvatarCropModalProps) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [boxSize] = useState(280);
  const [crop, setCrop] = useState({ x: 0.5, y: 0.5 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const probe = new Image();
    probe.onload = () => setImgSize({ w: probe.naturalWidth, h: probe.naturalHeight });
    probe.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !stageRef.current) return;
      const r = stageRef.current.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      setCrop({ x, y });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  if (!imgUrl || !imgSize) {
    return (
      <div className="modal-backdrop" data-testid="avatar-crop-modal">
        <div className="modal">加载中…</div>
      </div>
    );
  }

  const aspect = imgSize.w / imgSize.h;
  const stageW = boxSize;
  const stageH = boxSize / aspect;
  const displayW = aspect >= 1 ? stageW : stageH * aspect;
  const displayH = aspect >= 1 ? stageW / aspect : stageH;

  const cropBox = boxSize;

  const confirm = async () => {
    const scale = imgSize.w / displayW;
    const sourceSize = cropBox * scale;
    const sx = (crop.x * displayW) - cropBox / 2;
    const sy = (crop.y * displayH) - cropBox / 2;
    const safeSx = Math.max(0, Math.min(imgSize.w - sourceSize, sx * scale));
    const safeSy = Math.max(0, Math.min(imgSize.h - sourceSize, sy * scale));
    const canvas = document.createElement('canvas');
    canvas.width = TARGET_SIZE;
    canvas.height = TARGET_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(await loadImage(imgUrl), safeSx, safeSy, sourceSize, sourceSize, 0, 0, TARGET_SIZE, TARGET_SIZE);
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob(res, OUTPUT_MIME, OUTPUT_QUALITY),
    );
    if (blob) onConfirm(blob);
  };

  return (
    <div className="modal-backdrop" data-testid="avatar-crop-modal" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ padding: 24, maxWidth: 420 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>调整头像</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 13 }}>
          拖动选区调整头像位置，所选区域将裁剪为方形头像。
        </p>
        <div
          ref={stageRef}
          style={{
            position: 'relative',
            width: displayW,
            height: displayH,
            margin: '0 auto',
            background: '#f5f5f5',
            overflow: 'hidden',
            borderRadius: 8,
            cursor: 'move',
            touchAction: 'none',
          }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            dragging.current = true;
          }}
        >
          <img
            src={imgUrl}
            alt=""
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: 'brightness(0.5)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: `calc(${(crop.x - 0.5) * 100}% )`,
              top: `calc(${(crop.y - 0.5) * 100}% )`,
              width: cropBox,
              height: cropBox,
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
              border: '2px solid #fff',
              borderRadius: '50%',
              pointerEvents: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="button-secondary" onClick={onCancel}>取消</button>
          <button type="button" className="button-primary" onClick={confirm} data-testid="avatar-crop-confirm">
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = (e) => rej(e);
    img.src = src;
  });
}