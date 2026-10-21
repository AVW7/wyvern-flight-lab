import type { Metadata } from "next";
import FlightLabView from "./FlightLabView";

export const metadata: Metadata = {
  title: "Wyvern Flight Lab | Fantasy Biomes",
  description: "Inspect and tune the flight animation language of the Fantasy Biomes wyvern models.",
};

export default function FlightLabPage() {
  return <FlightLabView />;
}
