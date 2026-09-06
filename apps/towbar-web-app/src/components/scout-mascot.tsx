import Image from "next/image";

export function ScoutMascot({ size = 80 }: { size?: number }) {
  return (
    <Image
      src="/scout/mascot.webp"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className="pointer-events-none shrink-0 select-none object-contain"
    />
  );
}
