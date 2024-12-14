def serialize_object(obj):
    """Recursively serialize an object to a dictionary."""
    if isinstance(obj, dict):
        return {k: serialize_object(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple, set)):
        return [serialize_object(item) for item in obj]
    elif hasattr(obj, '__dataclass_fields__'):
        # For dataclasses
        return {k: serialize_object(v) for k, v in obj.__dict__.items()}
    elif hasattr(obj, '__dict__'):
        # For regular class instances
        return {k: serialize_object(v) for k, v in obj.__dict__.items() if not k.startswith('_')}
    elif hasattr(obj, '__slots__'):
        # For classes with __slots__
        return {slot: serialize_object(getattr(obj, slot)) for slot in obj.__slots__}
    elif isinstance(obj, (str, int, float, bool, type(None))):
        return obj
    else:
        # Try to serialize as an iterable
        try:
            return [serialize_object(item) for item in obj]
        except TypeError:
            # Fallback to string representation
            return str(obj)
