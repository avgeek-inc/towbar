import Image from "next/image";

export function ScoutMascot({
  size = 80,
  variant = "mascot",
}: {
  size?: number;
  variant?: "mascot" | "icon";
}) {
  return (
    <Image
      src={
        variant === "icon" ? "/scout/sidebar-icon-v2.png" : "/scout/mascot.webp"
      }
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="eager"
      decoding="sync"
      className="pointer-events-none shrink-0 select-none object-contain"
      unoptimized
    />
  );
}
