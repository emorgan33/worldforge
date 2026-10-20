import React from "react";
import {
  Skull,
  User,
  Building2,
  Home,
  MapPin,
  Compass,
  Shield,
  Swords,
  Dna,
  Users,
  Sparkles,
  Ship,
  Cpu,
  Boxes,
  Activity,
  Scroll,
  Scale,
  Languages,
  Calendar,
  Flame,
  BookOpen,
  Wand2,
  GitBranch,
  FileText,
  Feather,
  File,
  LucideProps,
} from "lucide-react";
import { ArticleTemplateType } from "@/types";

interface TemplateIconProps extends LucideProps {
  template: ArticleTemplateType | string;
}

export function TemplateIcon({ template, ...props }: TemplateIconProps) {
  switch (template.toUpperCase()) {
    case "CHARACTER":
    case "PERSON":
      return <User {...props} />;
    case "CREATURE":
      return <Skull {...props} />;
    case "ENCOUNTER":
      return <Swords {...props} />;
    case "SETTLEMENT":
      return <Building2 {...props} />;
    case "BUILDING":
      return <Home {...props} />;
    case "LANDMARK":
      return <MapPin {...props} />;
    case "GEOGRAPHY":
    case "LOCATION":
      return <Compass {...props} />;
    case "ORGANIZATION":
      return <Shield {...props} />;
    case "MILITARY":
    case "FORMATION":
      return <Swords {...props} />;
    case "SPECIES":
      return <Dna {...props} />;
    case "ETHNICITY":
      return <Users {...props} />;
    case "ITEM":
      return <Sparkles {...props} />;
    case "VEHICLE":
      return <Ship {...props} />;
    case "TECHNOLOGY":
      return <Cpu {...props} />;
    case "MATERIAL":
      return <Boxes {...props} />;
    case "CONDITION":
      return <Activity {...props} />;
    case "DOCUMENT":
      return <Scroll {...props} />;
    case "LAW":
      return <Scale {...props} />;
    case "LANGUAGE":
      return <Languages {...props} />;
    case "TRADITION":
      return <Calendar {...props} />;
    case "RITUAL":
      return <Flame {...props} />;
    case "MYTH":
      return <BookOpen {...props} />;
    case "SPELL":
      return <Wand2 {...props} />;
    case "PLOT":
      return <GitBranch {...props} />;
    case "REPORT":
      return <FileText {...props} />;
    case "PROSE":
      return <Feather {...props} />;
    default:
      return <File {...props} />;
  }
}
