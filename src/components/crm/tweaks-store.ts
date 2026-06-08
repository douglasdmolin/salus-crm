"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TweakDensity = "compact" | "medium" | "rich";

export type Tweaks = {
  density: TweakDensity;
  showAiScore: boolean;
  showSentiment: boolean;
  showNextAction: boolean;
  showPreview: boolean;
  showAssignee: boolean;
  debugSources: boolean;
};

export const DEFAULT_TWEAKS: Tweaks = {
  density: "rich",
  showAiScore: true,
  showSentiment: true,
  showNextAction: true,
  showPreview: true,
  showAssignee: true,
  debugSources: false,
};

export const CLEAN_TWEAKS: Tweaks = {
  density: "compact",
  showAiScore: false,
  showSentiment: false,
  showNextAction: false,
  showPreview: false,
  showAssignee: false,
  debugSources: false,
};

type TweaksStore = Tweaks & {
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  applyPreset: (preset: "rich" | "clean") => void;
  panelVisible: boolean;
  togglePanel: () => void;
};

export const useTweaks = create<TweaksStore>()(
  persist(
    (set) => ({
      ...DEFAULT_TWEAKS,
      panelVisible: false,
      setTweak: (key, value) => set({ [key]: value } as Partial<TweaksStore>),
      applyPreset: (preset) => set(preset === "rich" ? DEFAULT_TWEAKS : CLEAN_TWEAKS),
      togglePanel: () => set((s) => ({ panelVisible: !s.panelVisible })),
    }),
    {
      name: "crm-tweaks",
      partialize: (s) => ({
        density: s.density,
        showAiScore: s.showAiScore,
        showSentiment: s.showSentiment,
        showNextAction: s.showNextAction,
        showPreview: s.showPreview,
        showAssignee: s.showAssignee,
        debugSources: s.debugSources,
      }),
    }
  )
);
