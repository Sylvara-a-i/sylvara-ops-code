"""Offline mutations must fail closed; no live record fixtures or credentials."""
import copy
import importlib.util
import json
import shutil
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('native_packet', ROOT / 'verify-packet.py')
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class SavedPacketTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'operations-overview/native-counts'
        shutil.copytree(ROOT, self.root, ignore=shutil.ignore_patterns('__pycache__'))
        baseline = Path(self.temp.name) / 'development-baseline'
        baseline.mkdir()
        shutil.copyfile(ROOT / '../../development-baseline/Operations_Dashboard.html', baseline / 'Operations_Dashboard.html')

    def packet(self, mutation):
        path = self.root / 'packet.json'
        data = json.loads(path.read_text())
        mutation(data)
        path.write_text(json.dumps(data))

    def source(self, filename, old, new, update_digest=True):
        path = self.root / filename
        text = path.read_text()
        self.assertIn(old, text)
        path.write_text(text.replace(old, new))
        if update_digest:
            self.packet(lambda p: p['sourceDigests'].__setitem__(filename, sha256(path.read_bytes()).hexdigest()))

    def rejected(self):
        with self.assertRaises((ValueError, KeyError, FileNotFoundError)):
            VERIFY.verify(self.root)

    def test_saved_checkpoint_passes(self):
        self.assertEqual(VERIFY.verify(self.root)['xmlSources'], 8)

    def test_complete_original_is_restored(self):
        before = (self.root / 'Operations_Dashboard.preimage.html').read_bytes()
        saved = (self.root / 'Operations_Dashboard.saved-readback.html').read_bytes()
        restored = VERIFY.restore_preimage(saved, before)
        self.assertEqual(restored, before)
        self.assertIn(b'<h1>Operations Overview</h1>', restored)
        self.assertIn(b'<p>Record inventory and review queues.</p>', restored)
        self.assertEqual(restored.count(b'<div class="sv-card">'), 6)

    def test_html_mutations_are_rejected(self):
        for old, new in [('company_count =', 'company_count_changed ='), ('<style>', '<style data-changed>'), ('Latest recorded billing sync', 'Changed sync'), ('Pending company changes', 'Changed queue')]:
            with self.subTest(old=old):
                original = (self.root / 'Operations_Dashboard.saved-readback.html').read_bytes()
                self.source('Operations_Dashboard.saved-readback.html', old, new)
                self.rejected()
                (self.root / 'Operations_Dashboard.saved-readback.html').write_bytes(original)
                self.packet(lambda p: p['sourceDigests'].__setitem__('Operations_Dashboard.saved-readback.html', sha256(original).hexdigest()))

    def test_extra_final_newline_is_rejected(self):
        path = self.root / 'Operations_Dashboard.saved-readback.html'
        path.write_bytes(path.read_bytes() + b'\n')
        self.rejected()

    def test_preimage_change_is_rejected(self):
        self.source('Operations_Dashboard.preimage.html', 'Records, not active paid plans', 'Paid plans')
        self.rejected()

    def test_count_source_mutations(self):
        for filename, variable, form, criteria, label in VERIFY.EXPECTED_MAPPINGS:
            with self.subTest(file=filename):
                original = (self.root / filename).read_bytes()
                self.source(filename, f'thisapp.{form}.ID.count', f'thisapp.{form}.ID.sum')
                self.rejected()
                (self.root / filename).write_bytes(original)
                self.packet(lambda p: p['sourceDigests'].__setitem__(filename, sha256(original).hexdigest()))

    def test_billing_environment_cannot_be_removed(self):
        self.source('failed-billing-events.zml', 'Environment == &quot;Development&quot; &amp;&amp; ', '')
        self.rejected()

    def test_count_action_is_rejected(self):
        self.source('company-records.zml', "type='Form Data'", "action='OpenReport' type='Form Data'")
        self.rejected()

    def test_hardcoded_zero_is_rejected(self):
        self.source('company-records.zml', "type='Form Data'", "type='Text'")
        self.rejected()

    def test_actual_display_drift_is_rejected(self):
        self.source('company-records.zml', "displayType='actual'", "displayType='percentage'")
        self.rejected()

    def test_history_mutations_are_rejected(self):
        for old, new in [("action='OpenReport'", "action='ExecuteFunction'"), ("target='same-window'", "target='new-window'"), ("componentLinkName='All_Company_Settings_Requests'", "componentLinkName='All_Accounts'"), ("text='View all company requests'", "text='View all company requests' queryParams='Status=Pending'")]:
            with self.subTest(old=old):
                original = (self.root / 'all-company-requests.zml').read_bytes()
                self.source('all-company-requests.zml', old, new)
                self.rejected()
                (self.root / 'all-company-requests.zml').write_bytes(original)
                self.packet(lambda p: p['sourceDigests'].__setitem__('all-company-requests.zml', sha256(original).hexdigest()))

    def test_inventory_mutations_are_rejected(self):
        mutations = [lambda p: p['savedRows'].pop(), lambda p: p['originalComponentOrder'].pop(),
                     lambda p: p['preservedReports'].pop(), lambda p: p['preservedChart'].__setitem__('source', 'Accounts'),
                     lambda p: p['nativeComponents'].__setitem__('panel_1', 'company-records.zml')]
        original = json.loads((self.root / 'packet.json').read_text())
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                data = copy.deepcopy(original); mutation(data)
                (self.root / 'packet.json').write_text(json.dumps(data)); self.rejected()

    def test_each_report_control_change_is_rejected(self):
        original = json.loads((self.root / 'packet.json').read_text())
        for key in VERIFY.CONTROLS:
            with self.subTest(control=key):
                data = copy.deepcopy(original)
                data['pendingQueue']['controls'][key] = not data['pendingQueue']['controls'][key]
                (self.root / 'packet.json').write_text(json.dumps(data)); self.rejected()

    def test_queue_filter_and_title_drift(self):
        original = json.loads((self.root / 'packet.json').read_text())
        for key, value in [('criteria', 'ID != 0'), ('title', 'All company changes')]:
            with self.subTest(field=key):
                data = copy.deepcopy(original)
                data['pendingQueue'][key] = value
                (self.root / 'packet.json').write_text(json.dumps(data))
                self.rejected()

    def test_target_scope_drift(self):
        self.packet(lambda p: p['target'].__setitem__('environment', 'Production'))
        self.rejected()

    def test_qualification_cannot_be_broadened(self):
        self.packet(lambda p: p['qualification'].__setitem__('clientTenantIsolation', True))
        self.rejected()

    def test_missing_and_extra_sources(self):
        with self.subTest(case='extra'):
            extra = self.root / 'extra.zml'
            extra.write_text('<panel/>')
            self.rejected()
            extra.unlink()
        with self.subTest(case='missing'):
            (self.root / 'company-records.zml').unlink()
            self.rejected()

    def test_digest_mismatch_is_rejected(self):
        self.source('company-records.zml', "padding='20px'", "padding='21px'", update_digest=False)
        self.rejected()


if __name__ == '__main__':
    unittest.main()
