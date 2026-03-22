import Image from "next/image";
import { MY_NOTARY_LOGO_SRC } from "@/lib/brand";

/** Logo en haut à gauche, dans le flux du document (évite le chevauchement avec le contenu sur mobile). */
export function SessionPreRoomLogo() {
  return (
    <div className="mb-6 w-full shrink-0 sm:mb-8">
      <Image
        src={MY_NOTARY_LOGO_SRC}
        alt="My Notary"
        width={200}
        height={24}
        unoptimized
        className="h-6 w-auto max-w-[200px] object-left object-contain sm:max-w-none"
      />
    </div>
  );
}
