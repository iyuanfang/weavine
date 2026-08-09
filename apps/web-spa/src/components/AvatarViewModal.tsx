interface AvatarViewModalProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export function AvatarViewModal({ src, alt, onClose }: AvatarViewModalProps) {
  return (
    <div className="modal-backdrop" data-testid="avatar-view-modal" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 0, background: 'transparent', boxShadow: 'none', maxWidth: 480 }}
      >
        <img
          src={src}
          alt={alt}
          style={{
            display: 'block',
            width: '100%',
            maxWidth: 480,
            height: 'auto',
            borderRadius: 12,
          }}
        />
      </div>
    </div>
  );
}