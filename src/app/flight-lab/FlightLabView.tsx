"use client";

import dynamic from "next/dynamic";

const FlightLabClient = dynamic(() => import("./FlightLabClient"), {
  ssr: false,
});

export default function FlightLabView() {
  return <FlightLabClient />;
}
