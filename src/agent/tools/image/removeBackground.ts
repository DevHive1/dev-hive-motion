/**
 * remove_background: strip a uniform-color background from an image.
 *
 * Wraps the `backgroundRemoval` server utility as an agent-callable
 * tool. The agent (or user) provides an image URL — either an uploaded
 * /uploads/... path, an external URL from search_stock_images, or an
 * output of generate_ai_image — and the tool returns the same image
 * with the background color set to transparent.
 *
 * Returns just the URL and dimensions so the agent can pipe it
 * straight into add_image_element's src field.
 */

import { removeBackground as removeBackgroundCore, removeBackgroundDef } from "../../../server/backgroundRemoval";

export const backgroundRemovalDef = removeBackgroundDef;
export const backgroundRemovalImpl = removeBackgroundCore;
