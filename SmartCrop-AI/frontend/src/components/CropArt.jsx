import { useState } from "react";
import { Sprout } from "lucide-react";
import { useT } from "../i18n/LanguageContext";
import { cropName } from "../utils/format";
import brinjal from "../assets/photos/crop-brinjal.webp";
import cabbage from "../assets/photos/crop-cabbage.webp";
import cauliflower from "../assets/photos/crop-cauliflower.webp";
import onion from "../assets/photos/crop-onion.webp";
import potato from "../assets/photos/crop-potato.webp";
import tomato from "../assets/photos/crop-tomato.webp";
import wheat from "../assets/photos/crop-wheat.webp";

// Local, optimised photos keyed by the crop name exactly as the API returns it (see assets/photos/CREDITS.md).
export const PHOTOS = { Brinjal: brinjal, Cabbage: cabbage, Cauliflower: cauliflower, Onion: onion, Potato: potato, Tomato: tomato, Wheat: wheat };

/**
 * Square crop photo. `decorative` hides it from screen readers when the crop name is shown next to it.
 * Width and height are fixed so nothing shifts while it loads; an unknown crop or a failed load shows a sprout.
 */
export default function CropArt({ crop, size = 48, className = "", decorative = false }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const src = PHOTOS[crop];
  const label = t("art.cropAlt", { crop: cropName(t, crop) || "" });
  if (!src || failed) {
    return (
      <span className={`crop-art crop-art-fallback ${className}`} style={{ width: size, height: size }}
        {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}>
        <Sprout size={Math.round(size * 0.55)} aria-hidden="true" />
      </span>
    );
  }
  return (
    <img className={`crop-art crop-photo ${className}`} src={src} width={size} height={size} loading="lazy" decoding="async"
      alt={decorative ? "" : label} onError={() => setFailed(true)} />
  );
}
