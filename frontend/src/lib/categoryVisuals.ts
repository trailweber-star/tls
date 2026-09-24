import {
  Activity,
  Bone,
  Building2,
  Ear,
  HeartPulse,
  Hospital,
  type LucideIcon,
  Pill,
  Scale,
  Smile,
  Sparkles,
  Stethoscope,
} from "lucide-react";

// Maps a taxonomy top-level slug to an icon + gradient pair used on the
// category tiles (homepage grid, facility browse tiles). Deliberately
// data-driven rather than hard-coded per component, and falls back to a
// sane default for any future top-level category the taxonomy grows.
interface CategoryVisual {
  icon: LucideIcon;
  gradient: string; // tailwind gradient classes
}

const VISUALS: Record<string, CategoryVisual> = {
  orthopaedics: { icon: Bone, gradient: "from-teal-600 to-navy-800" },
  physiotherapy: { icon: Activity, gradient: "from-leaf-500 to-teal-700" },
  dentistry: { icon: Smile, gradient: "from-teal-500 to-teal-800" },
  "aesthetics-specialists": { icon: Sparkles, gradient: "from-teal-400 to-navy-700" },
  ent: { icon: Ear, gradient: "from-leaf-400 to-teal-700" },
  gynaecology: { icon: HeartPulse, gradient: "from-teal-600 to-navy-900" },
  "expert-witness": { icon: Scale, gradient: "from-navy-800 to-teal-700" },

  "hospital-care": { icon: Hospital, gradient: "from-navy-800 to-teal-700" },
  "care-homes": { icon: Building2, gradient: "from-leaf-500 to-navy-800" },
  pharmacy: { icon: Pill, gradient: "from-teal-500 to-navy-700" },
  clinics: { icon: Stethoscope, gradient: "from-teal-600 to-teal-900" },
  hospitals: { icon: Hospital, gradient: "from-navy-900 to-teal-600" },
};

const DEFAULT_VISUAL: CategoryVisual = { icon: Stethoscope, gradient: "from-teal-600 to-navy-800" };

export function categoryVisual(slug: string): CategoryVisual {
  return VISUALS[slug] ?? DEFAULT_VISUAL;
}
