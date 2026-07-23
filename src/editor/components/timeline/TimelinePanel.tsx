import React from "react";
import type { Composition } from "../../../schema/scene";
import { NLETimelinePanel } from "./NLETimelinePanel";

interface TimelinePanelProps {
  composition: Composition;
  selectedSceneId: string | null;
  selectedElementId?: string | null;
  soloSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  onSelectElement?: (elementId: string | null) => void;
  onToggleSolo: (sceneId: string) => void;
  onPatchElement?: (elementId: string, patch: Record<string, unknown>) => void;
  onAddScene?: () => void;
  onDeleteScene?: (sceneId: string) => void;
  onUpdateSceneDuration?: (sceneId: string, frames: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  composition,
  selectedSceneId,
  selectedElementId = null,
  soloSceneId,
  onSelectScene,
  onSelectElement = () => {},
  onToggleSolo,
  onPatchElement,
  onAddScene,
  onDeleteScene,
  onUpdateSceneDuration,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}) => {
  return (
    <NLETimelinePanel
      composition={composition}
      selectedSceneId={selectedSceneId}
      selectedElementId={selectedElementId}
      soloSceneId={soloSceneId}
      onSelectScene={onSelectScene}
      onSelectElement={onSelectElement}
      onToggleSolo={onToggleSolo}
      onPatchElement={onPatchElement}
      onUpdateSceneDuration={onUpdateSceneDuration}
      onAddScene={onAddScene}
      onDeleteScene={onDeleteScene}
      onUndo={onUndo}
      onRedo={onRedo}
      canUndo={canUndo}
      canRedo={canRedo}
    />
  );
};
