import Image from 'next/image';

const artwork = { canvas: 1254, x: 264, y: 258, width: 724, height: 766 };

export default function Logo({ width = 104 }: { width?: number }) {
  return <span className="nour-logo" style={{ width, aspectRatio: `${artwork.width} / ${artwork.height}` }}>
    <Image
      src="/nour-logo.png"
      alt="NOUR"
      width={artwork.canvas}
      height={artwork.canvas}
      sizes={`${Math.ceil(width * artwork.canvas / artwork.width)}px`}
      loading="eager"
      className="nour-logo-image"
      style={{
        left: `${-artwork.x / artwork.width * 100}%`,
        top: `${-artwork.y / artwork.height * 100}%`,
        width: `${artwork.canvas / artwork.width * 100}%`,
        height: 'auto',
      }}
    />
  </span>;
}
