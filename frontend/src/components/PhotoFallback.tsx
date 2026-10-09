import { useEffect, useState } from "react";
import logoImg from "../assets/images/logo.webp";

// Shown in place of a portrait when a specialist has no photoUrl yet.
// Uses the site logo so an empty listing still looks intentional and
// never implies a stock or wrong person's face.
export function PhotoFallback({
  className = "",
  logoClassName = "w-1/2",
  dark = false,
}: {
  className?: string;
  logoClassName?: string;
  dark?: boolean;
}) {
  return (
    <div
      className={`grid h-full w-full place-items-center ${
        dark ? "bg-navy-800" : "bg-gradient-to-br from-paper-tint to-teal-50"
      } ${className}`}
    >
      <img
        src={logoImg}
        alt="Top Local Specialists"
        className={`${logoClassName} max-w-full object-contain ${dark ? "opacity-90" : "opacity-80"}`}
        loading="lazy"
      />
    </div>
  );
}

/**
 * A portrait that falls back to the site logo when the photo is missing
 * OR fails to load. Imported listings carry photo links on somebody
 * else's server, and those sometimes 404 or refuse hot linking; without
 * this the visitor sees a broken image icon instead of the logo.
 */
export function PortraitImage({
  src,
  alt,
  width,
  height,
  imgClassName = "h-full w-full object-cover",
  fallbackLogoClassName = "w-1/2",
  dark = false,
  loading = "lazy",
}: {
  src: string | null | undefined;
  alt: string;
  width?: number;
  height?: number;
  imgClassName?: string;
  fallbackLogoClassName?: string;
  dark?: boolean;
  loading?: "lazy" | "eager";
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);

  if (!src || broken) return <PhotoFallback dark={dark} logoClassName={fallbackLogoClassName} />;
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      onError={() => setBroken(true)}
      className={imgClassName}
    />
  );
}
