import { sceneStore } from "../../../store/compositionStore";
import { getPresetDimensions, OrientationPreset } from "../../../schema/scene";
import { z } from "zod";

export const setOrientationDef = {
  type: "function",
  function: {
    name: "set_orientation",
    description:
      "Change project orientation (landscape: 1920x1080, portrait: 1080x1920, square: 1080x1080) — automatically updates composition dimensions.",
    parameters: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["landscape", "portrait", "square"],
          description: "Orientation preset",
        },
      },
      required: ["preset"],
    },
  },
};

export async function setOrientationImpl(args: Record<string, unknown>) {
  const preset = OrientationPreset.parse(args.preset);
  const dims = getPresetDimensions(preset);

  const updated = await sceneStore.update((draft) => {
    draft.orientation = preset;
    draft.width = dims.width;
    draft.height = dims.height;
    return draft;
  });

  return {
    success: true,
    orientation: preset,
    width: dims.width,
    height: dims.height,
  };
}
