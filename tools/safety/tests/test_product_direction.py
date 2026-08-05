import re
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
PRODUCT_ROOT = REPOSITORY_ROOT / "docs" / "product"
PRODUCT_DIRECTION = PRODUCT_ROOT / "README.md"
ADR_PATH = (
    REPOSITORY_ROOT
    / "docs"
    / "adr"
    / "0002-managed-home-service-receptionist-product-boundary.md"
)

RAW_SOURCE_SUFFIXES = {
    ".doc",
    ".docx",
    ".jpeg",
    ".jpg",
    ".pdf",
    ".png",
    ".webp",
    ".xlsx",
}

PRIVATE_SOURCE_MARKERS = (
    "C:\\Users",
    "C:/Users",
    '"source_filename"',
    '"source_path"',
)


class ProductDirectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.product_text = PRODUCT_DIRECTION.read_text(encoding="utf-8")
        cls.adr_text = ADR_PATH.read_text(encoding="utf-8")
        cls.public_files = sorted(
            path for path in PRODUCT_ROOT.rglob("*") if path.is_file()
        )

    def test_public_product_surface_is_small_and_text_only(self):
        self.assertIn(PRODUCT_DIRECTION, self.public_files)
        self.assertGreater(len(self.public_files), 0)
        for path in self.public_files:
            self.assertNotIn(path.suffix.lower(), RAW_SOURCE_SUFFIXES, path)
            self.assertLess(path.stat().st_size, 2 * 1024 * 1024, path)
            path.read_text(encoding="utf-8")

    def test_product_direction_and_adr_each_have_one_h1(self):
        for path, text in (
            (PRODUCT_DIRECTION, self.product_text),
            (ADR_PATH, self.adr_text),
        ):
            headings = [line for line in text.splitlines() if line.startswith("# ")]
            self.assertEqual(1, len(headings), path)

    def test_product_direction_captures_the_accepted_boundary(self):
        required_markers = (
            "Accepted for validation",
            "Kansas City home-service operators",
            "after-hours and overflow",
            "Complete workflows, not conversations",
            "Expand coverage progressively",
            "Preserve vendor portability",
            "Property management remains a later candidate",
            "a broad agency that accepts any AI automation project",
            "Keep the initial product inbound",
            "tested no-record fallback",
            "Do not request or collect payment-card numbers",
        )
        for marker in required_markers:
            self.assertIn(marker, self.product_text)

    def test_private_report_and_commercial_models_are_not_published(self):
        combined = self.product_text + "\n" + self.adr_text
        for marker in PRIVATE_SOURCE_MARKERS:
            self.assertNotIn(marker, combined)
        self.assertIsNone(re.search(r"\$\s*\d", combined))
        self.assertIn("proposed pricing", self.product_text)
        self.assertIn("financial models", self.product_text)
        self.assertIn("remain outside GitHub", self.product_text)

    def test_product_document_links_resolve_inside_the_repository(self):
        pattern = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
        for raw_target in pattern.findall(self.product_text):
            target = raw_target.strip().split("#", 1)[0]
            if not target or target.startswith(("https://", "http://", "mailto:")):
                continue
            resolved = (PRODUCT_DIRECTION.parent / target).resolve()
            self.assertTrue(resolved.is_relative_to(REPOSITORY_ROOT.resolve()))
            self.assertTrue(resolved.exists(), raw_target)

    def test_repository_navigation_points_to_product_direction(self):
        root_readme = (REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")
        agent_policy = (REPOSITORY_ROOT / "AGENTS.md").read_text(encoding="utf-8")
        architecture = (
            REPOSITORY_ROOT / "docs" / "architecture" / "system-overview.md"
        ).read_text(encoding="utf-8")
        product_link = "[`docs/product/README.md`](docs/product/README.md)"
        self.assertIn(product_link, root_readme)
        self.assertIn(product_link, agent_policy)
        self.assertIn("../product/README.md", architecture)


if __name__ == "__main__":
    unittest.main()
