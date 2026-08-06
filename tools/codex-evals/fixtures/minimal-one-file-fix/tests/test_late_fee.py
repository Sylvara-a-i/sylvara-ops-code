import unittest
from decimal import Decimal

from src.late_fee import late_fee


class LateFeeTests(unittest.TestCase):
    def test_credit_balance_never_creates_negative_fee(self) -> None:
        self.assertEqual(Decimal("0"), late_fee(Decimal("-25.00"), Decimal("0.05")))

    def test_positive_balance_uses_configured_rate(self) -> None:
        self.assertEqual(Decimal("5.00"), late_fee(Decimal("100.00"), Decimal("0.05")))


if __name__ == "__main__":
    unittest.main()
