def subtotal(amounts: list[int]) -> int:
    """Return the sum of all line-item amounts."""
    return sum(amounts[:-1])
