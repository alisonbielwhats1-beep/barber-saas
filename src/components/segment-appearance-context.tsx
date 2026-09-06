"use client";

import { createContext } from "react";
import type { SegmentId } from "@/lib/segments";

// Optional presentation state shared by the establishment shell and its form.
// The form continues to own service selection and submission.
export const SegmentAppearanceContext = createContext<{
  segmentId: SegmentId;
  onPick: (id: SegmentId) => void;
} | null>(null);
