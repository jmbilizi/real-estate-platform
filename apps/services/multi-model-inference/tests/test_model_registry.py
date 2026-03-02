"""Tests for the model registry."""

import pytest

from multi_model_inference.core.model_registry import ModelRegistry


class FakeModel:
    """Minimal model implementation for testing."""

    def __init__(self, should_fail_load=False):
        self._loaded = False
        self._should_fail = should_fail_load

    def load(self):
        if self._should_fail:
            raise RuntimeError("Simulated load failure")
        self._loaded = True

    def unload(self):
        self._loaded = False

    def predict(self, inputs):
        return inputs

    def model_info(self):
        return {
            "name": "fake",
            "status": "loaded" if self._loaded else "not_loaded",
        }

    @property
    def is_ready(self):
        return self._loaded


def test_register_and_get():
    """Registering a model makes it retrievable by name."""
    reg = ModelRegistry()
    model = FakeModel()
    reg.register("test-model", model)
    assert reg.get("test-model") is model


def test_get_unregistered_raises():
    """Accessing an unregistered model raises KeyError."""
    reg = ModelRegistry()
    with pytest.raises(KeyError, match="not registered"):
        reg.get("nonexistent")


def test_load_all():
    """load_all calls load on every registered model."""
    reg = ModelRegistry()
    m1 = FakeModel()
    m2 = FakeModel()
    reg.register("m1", m1)
    reg.register("m2", m2)
    reg.load_all()
    assert m1.is_ready
    assert m2.is_ready


def test_load_all_handles_failure():
    """load_all continues loading other models if one fails."""
    reg = ModelRegistry()
    m1 = FakeModel(should_fail_load=True)
    m2 = FakeModel()
    reg.register("m1", m1)
    reg.register("m2", m2)
    reg.load_all()
    assert not m1.is_ready
    assert m2.is_ready


def test_unload_all():
    """unload_all unloads every model."""
    reg = ModelRegistry()
    m1 = FakeModel()
    reg.register("m1", m1)
    reg.load_all()
    assert m1.is_ready
    reg.unload_all()
    assert not m1.is_ready


def test_list_models():
    """list_models returns info dicts for all models."""
    reg = ModelRegistry()
    reg.register("m1", FakeModel())
    reg.register("m2", FakeModel())
    infos = reg.list_models()
    assert len(infos) == 2


def test_all_ready_empty():
    """Empty registry reports all_ready=True."""
    reg = ModelRegistry()
    assert reg.all_ready()


def test_all_ready_mixed():
    """all_ready is False when some models are not loaded."""
    reg = ModelRegistry()
    m1 = FakeModel()
    m2 = FakeModel()
    reg.register("m1", m1)
    reg.register("m2", m2)
    m1.load()
    assert not reg.all_ready()


def test_model_names():
    """model_names lists all registered names."""
    reg = ModelRegistry()
    reg.register("a", FakeModel())
    reg.register("b", FakeModel())
    assert reg.model_names == ["a", "b"]
