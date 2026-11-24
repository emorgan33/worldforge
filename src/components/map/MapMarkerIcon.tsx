import { Castle, Crown, Eye, Flag, Footprints, Gem, Home, MapPin, Skull, Star, TreePine, Zap } from "lucide-react";

/** Shared marker icon set for the editor and the read-only player map. */
export function MapMarkerIcon({ name, className = "h-3.5 w-3.5" }: { name?: string | null; className?: string }) {
  switch (name?.toLowerCase()) {
    case "castle": return <Castle className={className} />;
    case "skull": return <Skull className={className} />;
    case "zap": return <Zap className={className} />;
    case "eye": return <Eye className={className} />;
    case "flag": return <Flag className={className} />;
    case "star": return <Star className={className} />;
    case "gem": return <Gem className={className} />;
    case "tree-pine": return <TreePine className={className} />;
    case "home": return <Home className={className} />;
    case "crown": return <Crown className={className} />;
    case "footprints": return <Footprints className={className} />;
    default: return <MapPin className={className} />;
  }
}
