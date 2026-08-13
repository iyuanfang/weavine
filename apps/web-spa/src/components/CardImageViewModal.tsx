interface CardImageViewModalProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export function CardImageViewModal({ src, alt, onClose }: CardImageViewModalProps) {
  return (
    <div className="modal-backdrop" data-testid="card-image-view-modal" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 0, background: 'transparent', boxShadow: 'none', maxWidth: 640 }}
      >
        <img
          src={src}
          alt={alt}
          style={{
            display: 'block',
            width: '100%',
            maxWidth: 640,
            height: 'auto',
            borderRadius: 8,
          }}
        />
      </div>
    </div>
  );
}