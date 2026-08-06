import unittest

from src.totals import subtotal


class TotalsTests(unittest.TestCase):
    def test_subtotal_includes_every_line_item(self) -> None:
        self.assertEqual(60, subtotal([10, 20, 30]))


if __name__ == "__main__":
    unittest.main()
