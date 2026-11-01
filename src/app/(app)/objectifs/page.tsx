import type { Metadata } from "next";
import { GoalsScreen } from "@/features/goals/goals-screen";

export const metadata: Metadata = { title: "Objectifs" };

export default function GoalsPage() {
  return <GoalsScreen />;
}
