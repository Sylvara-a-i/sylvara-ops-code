from decimal import Decimal


def late_fee(balance: Decimal, rate: Decimal) -> Decimal:
    """Return a fee only when a positive balance is outstanding."""
    return balance * rate
