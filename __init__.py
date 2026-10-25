"""Bounding-box canvas for the classic (Nodes 1.0 / LiteGraph) frontend.

Core ComfyUI ships `CreateBoundingBoxes`, but its drawing widget is only
implemented for Nodes 2.0 (Vue). This node is a drop-in equivalent whose
canvas is a plain DOM widget, so it works in Nodes 1.0. Its outputs are
identical to the core node, so it plugs straight into `Flux3LayoutPrompt`
(FLUX 3 Image Layout Prompt) and the Ideogram nodes.
"""

import json

import nodes
from typing_extensions import override

from comfy_api.latest import ComfyExtension, io

try:
    from comfy_extras.nodes_bounding_boxes import (
        _bg_from_image,
        boxes_from_input,
        boxes_to_regions,
        build_elements,
        fractions_to_bbox_frame,
        render_preview,
    )
except ImportError as exc:  # pragma: no cover - depends on ComfyUI version
    raise ImportError(
        "comfyui-bbox-legacy needs a ComfyUI version that ships "
        "comfy_extras/nodes_bounding_boxes.py (update ComfyUI)."
    ) from exc

WEB_DIRECTORY = "./js"


def _json_list(text) -> list:
    if isinstance(text, list):
        return text
    if not isinstance(text, str) or not text.strip():
        return []
    try:
        data = json.loads(text)
    except ValueError:
        return []
    return data if isinstance(data, list) else []


class CreateBoundingBoxesLegacy(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CreateBoundingBoxesLegacy",
            display_name="Create Bounding Boxes (Nodes 1.0)",
            category="utilities",
            description="Draw bounding boxes in a canvas that works in the classic Nodes 1.0 frontend. "
                        "Outputs the same preview, pixel-space bounding boxes and prompt elements as the core "
                        "Create Bounding Boxes node.",
            inputs=[
                io.Image.Input(
                    "background",
                    optional=True,
                    tooltip="Optional image used as background in the canvas and preview.",
                ),
                io.MultiType.Input(
                    "bboxes",
                    [io.BoundingBox, io.Array, io.String],
                    optional=True,
                    tooltip="Bounding boxes, elements, or a JSON string to initialize the canvas. A new upstream "
                            "value replaces the canvas; edits made afterwards are kept until it changes again.",
                ),
                io.Int.Input("width", default=1024, min=64, max=16384, step=16,
                             tooltip="Width of the canvas and the pixel grid for the bounding boxes. "
                                     "Ignored (and hidden) when a background image is connected."),
                io.Int.Input("height", default=1024, min=64, max=16384, step=16,
                             tooltip="Height of the canvas and the pixel grid for the bounding boxes. "
                                     "Ignored (and hidden) when a background image is connected."),
                io.String.Input(
                    "editor_state",
                    default="[]",
                    socketless=True,
                    tooltip="Internal: the boxes drawn on the canvas, as JSON.",
                ),
                io.String.Input(
                    "last_incoming",
                    default="[]",
                    socketless=True,
                    tooltip="Internal: the upstream bboxes value that last initialized the canvas.",
                ),
            ],
            outputs=[
                io.Image.Output(display_name="preview"),
                io.BoundingBox.Output(display_name="bboxes"),
                io.Array.Output(display_name="elements"),
            ],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, width, height, editor_state="[]", last_incoming="[]", background=None, bboxes=None) -> io.NodeOutput:
        incoming = boxes_from_input(bboxes, width, height)
        applied = _json_list(last_incoming)
        upstream_changed = bool(incoming) and incoming != applied
        source = incoming if upstream_changed else _json_list(editor_state)
        regions = boxes_to_regions(source, width, height)
        has_background = background is not None and len(background) > 0
        if has_background:
            # Inherit the background's real resolution, even on a run where the
            # canvas has not seen the image yet and width/height are stale.
            height, width = int(background.shape[1]), int(background.shape[2])
        preview = render_preview(regions, width, height, _bg_from_image(background))
        ui = {"dims": [width, height]}
        if incoming:
            ui["input_bboxes"] = incoming
        if has_background:
            saved = nodes.PreviewImage().save_images(background[:1], "comfy.bboxes.background")
            ui["background_images"] = saved["ui"]["images"]
        return io.NodeOutput(
            preview,
            fractions_to_bbox_frame(regions, width, height),
            build_elements(regions),
            ui=ui,
        )


class BBoxLegacyExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [CreateBoundingBoxesLegacy]


async def comfy_entrypoint() -> BBoxLegacyExtension:
    return BBoxLegacyExtension()
