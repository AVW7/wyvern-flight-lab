"""Blender Action API compatibility adapter.

Bridges Blender 4.4+ Layered Actions (slots, layers, strips, channelbags)
and legacy flat Actions (action.fcurves) so scripts work across Blender versions.
"""

from __future__ import annotations

from typing import Any, Iterable


class ActionCompat:
    """Compatibility wrapper for Blender Actions across API versions."""

    @staticmethod
    def is_layered(action: Any) -> bool:
        """True if the action uses Blender 4.4+ Layered Animation API."""
        return hasattr(action, "layers") and hasattr(action, "slots")

    @staticmethod
    def iter_fcurves(action: Any, slot_identifier: str | None = None) -> Iterable[Any]:
        """Yield curves from legacy and layered Actions, optionally filtering by slot."""
        if hasattr(action, "fcurves"):
            yield from action.fcurves
            return

        for layer in getattr(action, "layers", []):
            for strip in getattr(layer, "strips", []):
                if getattr(strip, "type", None) != "KEYFRAME":
                    continue
                for bag in getattr(strip, "channelbags", []):
                    slot = getattr(bag, "slot", None)
                    if slot_identifier and (slot is None or slot.identifier != slot_identifier):
                        continue
                    yield from getattr(bag, "fcurves", [])

    @staticmethod
    def setup_slotted_action(action: Any, armature: Any, layer_name: str = "Base") -> Any:
        """Ensure an action has proper slot, layer, strip, and channelbag on Blender 4.4+.

        Returns the channelbag on 4.4+, or the action itself on legacy versions.
        """
        if not ActionCompat.is_layered(action):
            return action

        slot_name = f"OB{armature.name}"
        slot = next(
            (s for s in action.slots if getattr(s, "identifier", None) == slot_name or getattr(s, "name", None) == armature.name),
            None,
        )
        if slot is None:
            slot = action.slots.new(id_type="OBJECT", name=armature.name)

        if armature.animation_data:
            armature.animation_data.action = action
            try:
                armature.animation_data.action_slot = slot
            except Exception:
                pass

        layer = action.layers.get(layer_name) or action.layers.new(layer_name)
        strip = layer.strips[0] if len(layer.strips) > 0 else layer.strips.new(type="KEYFRAME")
        
        bag = next((b for b in strip.channelbags if getattr(b, "slot", None) == slot), None)
        if bag is None:
            bag = strip.channelbags.new(slot)
        return bag

    @staticmethod
    def find_fcurve(action: Any, data_path: str, index: int = 0, slot_identifier: str | None = None) -> Any | None:
        """Find an fcurve matching data_path and array index."""
        for curve in ActionCompat.iter_fcurves(action, slot_identifier):
            if curve.data_path == data_path and curve.array_index == index:
                return curve
        return None
