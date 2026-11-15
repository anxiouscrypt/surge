import type { Priority } from "@surge/shared";
import type { IconName } from "../components/Icon";

export const HOME: [number, number] = [-83.637, 42.249];

export const PRIORITY_LABEL: Record<Priority, string> = {
  1: "Immediate",
  2: "Urgent",
  3: "Standard",
  4: "Low",
};
export const PRIORITY_COLOR: Record<Priority, string> = {
  1: "#ff6b6b",
  2: "#f5ae67",
  3: "#ead282",
  4: "#a1afc0",
};
export const TYPE_ICON: Record<string, IconName> = {
  fire: "fire",
  medical: "medical",
  traffic: "car",
  crime: "shield",
  water_rescue: "wave",
  hazard: "alert",
  other: "phone",
};
