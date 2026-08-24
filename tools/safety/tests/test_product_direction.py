import re
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
PRODUCT_ROOT = REPOSITORY_ROOT / "docs" / "product"
PRODUCT_DIRECTION = PRODUCT_ROOT / "README.md"
HISTORICAL_ADR = (
    REPOSITORY_ROOT
    / "docs"
    / "adr"
    / "0002-managed-home-service-receptionist-product-boundary.md"
)
CURRENT_ADR = (
    REPOSITORY_ROOT
    / "docs"
    / "adr"
    / "0007-revenue-desk-commercial-strategy.md"
)
STRATEGY_POINTER = REPOSITORY_ROOT / "STRATEGY.md"

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

LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


def local_links(source_path: Path, text: str):
    for raw_target in LINK_RE.findall(text):
        target = raw_target.strip().split("#", 1)[0]
        if not target or target.startswith(("https://", "http://", "mailto:")):
            continue
        yield raw_target, (source_path.parent / target).resolve()


class ProductDirectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.product_text = PRODUCT_DIRECTION.read_text(encoding="utf-8")
        cls.historical_adr_text = HISTORICAL_ADR.read_text(encoding="utf-8")
        cls.current_adr_text = CURRENT_ADR.read_text(encoding="utf-8")
        cls.strategy_pointer_text = STRATEGY_POINTER.read_text(encoding="utf-8")
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

    def test_strategy_documents_each_have_one_h1(self):
        for path, text in (
            (PRODUCT_DIRECTION, self.product_text),
            (HISTORICAL_ADR, self.historical_adr_text),
            (CURRENT_ADR, self.current_adr_text),
            (STRATEGY_POINTER, self.strategy_pointer_text),
        ):
            headings = [line for line in text.splitlines() if line.startswith("# ")]
            self.assertEqual(1, len(headings), path)

    def test_product_direction_captures_the_approved_strategy(self):
        required_markers = (
            "2026-08-24T13:39:38-05:00",
            "independent residential plumbing companies",
            "5–15 active field technicians",
            "7-Day / 25-Call Revenue Leak Test",
            "Complete workflows, not conversations",
            "Expand coverage progressively",
            "Preserve vendor portability",
            "Coverage volume is not the primary feature gate",
            "Launch — Managed AI Receptionist",
            "Growth — Managed Revenue Desk",
            "Growth is the recommended plan",
            "Scale — Managed Revenue Operations",
            "Revenue Recovery Ledger",
            "No-Surprise Calibration Month",
            "70% minimum",
            "payment-card numbers",
        )
        for marker in required_markers:
            with self.subTest(marker=marker):
                self.assertIn(marker, self.product_text)

    def test_approved_public_pricing_is_exact(self):
        for marker in (
            "$349",
            "$749",
            "$1,299",
            "$0.40 per connected AI minute",
            "$750",
            "$1,500",
            "$2,500",
            "Ten percent off management fees only",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.product_text + "\n" + self.current_adr_text)

        self.assertIn("$349 / $749 / $1,299", self.strategy_pointer_text)
        self.assertIn("$0.40 connected-minute rate", self.strategy_pointer_text)

    def test_current_adr_records_supersession_and_no_live_authority(self):
        for marker in (
            "Status: Accepted",
            "Supersedes in part",
            "Coverage volume is not the primary tier gate",
            "Growth is the recommended plan",
            "Deployment authorization: Not granted",
            "A repository merge does not authorize",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.current_adr_text)

        self.assertIn(
            "0007-revenue-desk-commercial-strategy.md",
            self.product_text,
        )
        self.assertIn(
            "docs/adr/0007-revenue-desk-commercial-strategy.md",
            self.strategy_pointer_text,
        )

    def test_private_source_and_sensitive_operating_data_are_not_published(self):
        combined = "\n".join(
            (
                self.product_text,
                self.historical_adr_text,
                self.current_adr_text,
                self.strategy_pointer_text,
            )
        )
        for marker in PRIVATE_SOURCE_MARKERS:
            self.assertNotIn(marker, combined)
        self.assertNotIn("raw research report", self.product_text.lower())
        self.assertNotIn("gabriel.potter@", combined.lower())
        self.assertNotIn("RETELL_WEBHOOK_API_KEY", combined)

    def test_strategy_links_resolve_inside_the_repository(self):
        for source_path, source_text in (
            (PRODUCT_DIRECTION, self.product_text),
            (CURRENT_ADR, self.current_adr_text),
            (STRATEGY_POINTER, self.strategy_pointer_text),
        ):
            for raw_target, resolved in local_links(source_path, source_text):
                with self.subTest(source=source_path, target=raw_target):
                    self.assertTrue(resolved.is_relative_to(REPOSITORY_ROOT.resolve()))
                    self.assertTrue(resolved.exists(), raw_target)

    def test_plumbing_first_and_implementation_boundaries_are_consistent(self):
        paths = (
            REPOSITORY_ROOT / "README.md",
            REPOSITORY_ROOT / "AGENTS.md",
            HISTORICAL_ADR,
            CURRENT_ADR,
            PRODUCT_DIRECTION,
            REPOSITORY_ROOT / "docs" / "architecture" / "system-overview.md",
        )
        texts = [path.read_text(encoding="utf-8") for path in paths]
        for path, text in zip(paths, texts):
            self.assertIn("plumb", text.lower(), path)

        self.assertIn("../legal-compliance/README.md", self.product_text)
        self.assertIn("accepted for offline synthetic validation only", self.product_text)
        self.assertIn("internal, non-sales QA", self.product_text)
        self.assertIn("Prospect-facing telephone demonstrations", self.product_text)
        self.assertIn("does not prove implementation", self.strategy_pointer_text)

    def test_repository_navigation_points_to_current_product_direction(self):
        root_readme = (REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")
        agent_policy = (REPOSITORY_ROOT / "AGENTS.md").read_text(encoding="utf-8")
        architecture = (
            REPOSITORY_ROOT / "docs" / "architecture" / "system-overview.md"
        ).read_text(encoding="utf-8")
        product_link = "[`docs/product/README.md`](docs/product/README.md)"
        self.assertIn(product_link, root_readme)
        self.assertIn(product_link, agent_policy)
        self.assertIn("../product/README.md", architecture)
        self.assertIn("Public pricing is allowed only", agent_policy)


if __name__ == "__main__":
    unittest.main()
