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
