# BBox Canvas for Nodes 1.0

ComfyUI core has a **Create Bounding Boxes** node, but its drawing canvas is only
implemented for the Nodes 2.0 (Vue) frontend. In the classic Nodes 1.0 frontend
it shows "Bounding Boxes is only available in Nodes 2.0" and you can't draw.

This pack adds **Create Bounding Boxes (Nodes 1.0)** (`utilities` category). It has the
same inputs and outputs as the core node, but its canvas is a plain DOM widget that
works in Nodes 1.0 (and Nodes 2.0).

## FLUX 3 Image / Klein layout

```
Create Bounding Boxes (Nodes 1.0) ──elements──► FLUX 3 Image Layout Prompt ──prompt──► CLIP Text Encode
```

In the prompt, reference box N as `<obj_N>` (e.g. "a cat <obj_1> sitting under a lamp <obj_2>").
FLUX 3 ignores colour palettes, so put colours in each box's description.

## Using the canvas

- **Drag on empty space** to draw a box. Draw the background first and the foreground last.
- **Drag a box or its number tag** to move it. **Drag edges/corners** to resize.
- **Alt+click** cycles through overlapping boxes.
- **Double-click** a box to jump to its description.
- **Del / Backspace** (with the canvas focused) deletes the selected box.
- Panel: Object/Text type, exact text (Text boxes), description, and up to 5 colours
  (right-click a swatch to remove it).
- **Grid** toggles snapping. **Clear all** removes every box.
- **background** input: the node inherits the image's resolution. `width`/`height` are
  hidden and follow the image (snapped to 16), and the `bboxes` output uses the image's exact
  pixel size, even on the first run. A connected Load Image shows up right away, and any other
  image appears after one run.
- **bboxes** input: a new upstream value (boxes, elements, or JSON) replaces the
  canvas once. After that your edits are kept until the upstream value changes.

## Outputs

| output   | type          | same as core |
|----------|---------------|--------------|
| preview  | IMAGE         | yes |
| bboxes   | BOUNDING_BOX  | yes |
| elements | ARRAY         | yes (`[{type, bbox:[ymin,xmin,ymax,xmax] 0-1000, desc, text?, color_palette?}]`) |

The node calls ComfyUI's own `comfy_extras/nodes_bounding_boxes.py` helpers, so the
results always match the core node. It needs a ComfyUI version that ships that file.
