"""Check the sanitized saved-source checkpoint offline; never contact Creator.

This verifies source preservation and mappings, not a fresh live deployment,
permissions, nonempty-data behavior, or client isolation. See README.md.
"""
import json
import re
from hashlib import sha256
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent
PREIMAGE_SHA = '8ff3079a4bbf6e588b8cc63f8c5b83069a27844c8c19eaf7db9f71ecbfb9104f'
SAVED_SHA = 'f050df4d5cc9caef599dfc2a9cf901d842383156caf55eb689c2bc03f55c7b60'
EXPECTED_MAPPINGS = [
    ('company-records.zml', 'company_count', 'Accounts', 'ID != 0', 'Company records'),
    ('subscription-records.zml', 'subscription_count', 'Subscriptions', 'ID != 0', 'Subscription records'),
    ('pending-provisioning.zml', 'pending_provision_count', 'Account_Services', 'Provisioning_Status == "Pending"', 'Pending provisioning'),
    ('failed-provisioning.zml', 'failed_provision_count', 'Account_Services', 'Provisioning_Status == "Failed"', 'Failed provisioning'),
    ('failed-billing-events.zml', 'failed_billing_count', 'Billing_Webhook_Events', 'Environment == "Development" && Processing_Status == "Failed"', 'Failed billing events'),
    ('pending-company-changes.zml', 'pending_request_count', 'Company_Settings_Requests', 'Status == "Pending review"', 'Pending company changes'),
]
ORIGINAL_COMPONENTS = ['html_snippet5', 'report_1', 'report_4', 'chart_1', 'report_3', 'report_2']
EXPECTED_ROWS = [['panel_1'], ['panel_2', 'panel_3'], ['panel_4', 'panel_5'], ['panel_6', 'panel_7'],
                 ['html_snippet5'], ['report_1'], ['panel_8'], ['report_4'], ['chart_1'], ['report_3'], ['report_2']]
CONTROLS = dict(zip(['add', 'edit', 'delete', 'duplicate', 'search', 'retainChanges', 'print', 'export',
                     'recordCount', 'bulkEdit', 'bulkDelete', 'bulkDuplicate', 'publicAccess'],
                    [False, False, False, False, True, False, False, False, True, False, False, False, False]))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def restore_preimage(saved, preimage):
    """Reconstruct the complete original, including heading/intro, with strict hashes."""
    require(sha256(preimage).hexdigest() == PREIMAGE_SHA, 'Preimage drift')
    require(sha256(saved).hexdigest() == SAVED_SHA, 'Saved HTML drift')
    remainder = saved + b'\n'  # Only the observed Creator final-LF normalization.
    restored = remainder[:8204] + preimage[8204:9389] + remainder[8204:]
    require(restored == preimage, 'Rollback must restore the entire original HTML')
    return restored


def verify(root=ROOT):
    root = Path(root)
    packet = json.loads((root / 'packet.json').read_text())
    require(packet['target'] == {'application': 'client-portal', 'environment': 'Development', 'page': 'Operations_Dashboard'}, 'Target scope drift')
    require(packet['sourceReference'] == 'Operations_Dashboard.preimage.html' and
            packet['savedHtml'] == 'Operations_Dashboard.saved-readback.html', 'HTML source paths drift')
    before = (root / packet['sourceReference']).read_bytes()
    saved = (root / packet['savedHtml']).read_bytes()
    require(len(before) == 11000 and len(saved) == 9814, 'HTML byte length drift')
    require(sha256(before).hexdigest() == PREIMAGE_SHA and sha256(saved).hexdigest() == SAVED_SHA, 'Captured HTML digest drift')
    require(saved + b'\n' == before[:8204] + before[9389:], 'Only the header/count block and final LF may differ')
    removed = before[8204:9389]
    require(removed.count(b'<div class="sv-card">') == 6 and removed.startswith(b'<h1>Operations Overview</h1>'), 'Incomplete replacement block')
    require(b'<div class="sv-counts">' not in saved and b'<h1>Operations Overview</h1>' not in saved, 'Duplicate header/count HTML')
    for pattern in [rb'<%(?![=])(.*?)%>', rb'<style>.*?</style>', rb'<section.*?</section>']:
        require(re.findall(pattern, before, re.S) == re.findall(pattern, saved, re.S), 'Deluge/styles/queues changed')
    require(restore_preimage(saved, before) == before, 'Full rollback mismatch')
    replacement = packet['htmlReplacement']
    require([replacement[k] for k in ['removedStartInclusive', 'removedEndExclusive', 'removedBytes', 'preimageBytes', 'savedBytes']] == [8204, 9389, 1185, 11000, 9814], 'Replacement manifest drift')
    # The immutable repository baseline remains historical. Fresh preimage differs
    # only by an already-absent billing note and its final newline, not new logic.
    baseline = (root / '../../development-baseline/Operations_Dashboard.html').resolve().read_bytes()
    note = b'<span class="sv-note">Failed</span>'
    require(baseline.count(note) == 1 and before == baseline.replace(note, b'') + b'\n', 'Unreviewed baseline-to-preimage drift')
    queries = re.findall(r'\b(\w+_count)\s*=\s*(\w+)\[(.*?)\]\.count\(\);', before.decode())
    require(len(queries) == 6, 'Legacy aggregate set drift')
    expected_queries = {variable: (form, criteria) for _, variable, form, criteria, _ in EXPECTED_MAPPINGS}
    require(dict((var, (form, criteria)) for var, form, criteria in queries) == expected_queries, 'Legacy aggregate mapping drift')
    expected_files = {'operations-header.zml', 'all-company-requests.zml', *(row[0] for row in EXPECTED_MAPPINGS)}
    require({p.name for p in root.glob('*.zml')} == expected_files, 'Native source set drift')
    require(set(packet['sourceDigests']) == expected_files | {packet['sourceReference'], packet['savedHtml']}, 'Digest source set drift')
    for filename, digest in packet['sourceDigests'].items():
        require(sha256((root / filename).read_bytes()).hexdigest() == digest, 'Source digest mismatch: ' + filename)
    names = set()

    def parse(filename, allow_button=False):
        panel = ET.parse(root / filename).getroot()
        require(panel.tag == 'panel' and panel.get('elementName') not in names, 'Missing/duplicate native element name')
        names.add(panel.get('elementName'))
        for node in panel.iter():
            require(node.tag in {'panel', 'pr', 'pc', 'text'} | ({'button'} if allow_button else set()), 'Unexpected native element')
            require(not any(key.lower().startswith('on') for key in node.attrib), 'Event handler prohibited')
            require('action' not in node.attrib or allow_button and node.tag == 'button', 'Only the navigation button may have an action')
        return panel

    require(packet['header'] == 'operations-header.zml', 'Header path drift')
    header = parse(packet['header'])
    require([n.get('value') for n in header.iter('text')] == ['Operations Overview', 'Record inventory and review queues.'], 'Header copy drift')
    require(all(n.get('type') == 'Text' for n in header.iter('text')), 'Header must remain static')
    require(len(packet['panels']) == 6, 'Expected six counts')
    for item, (filename, variable, form, criteria, label) in zip(packet['panels'], EXPECTED_MAPPINGS):
        require(item == {'file': filename, 'form': form, 'aggregate': 'ID.count', 'criteria': criteria, 'legacyVariable': variable}, 'Count manifest drift')
        panel = parse(filename)
        texts = list(panel.iter('text'))
        require(texts[0].get('value') == label, 'Count label drift')
        require(all(n.get('type') in {'Text', 'Form Data'} for n in texts), 'Unsupported display type')
        data = [n for n in texts if n.get('type') == 'Form Data']
        require(len(data) == 1, 'Exactly one native aggregate per card')
        node = data[0]
        require(node.get('value') == f'thisapp.{form}.ID.count' and node.get('criteria') == criteria, 'Native Count mapping drift')
        expected_display = None if filename == 'pending-company-changes.zml' else 'actual'
        require(node.get('displayType') == expected_display, 'Saved Actual/default display drift')
        require(node.get('size') == '32px' and not any(k in node.attrib for k in ['prefix', 'suffix', 'units']), 'Count display drift')
    nav = parse('all-company-requests.zml', allow_button=True)
    buttons = list(nav.iter('button'))
    require(len(buttons) == 1 and not list(nav.iter('text')), 'Expected one navigation button')
    button = buttons[0]
    expected_action = {'action': 'OpenReport', 'componentLinkName': 'All_Company_Settings_Requests', 'target': 'same-window', 'text': 'View all company requests'}
    require(all(button.get(k) == v for k, v in expected_action.items()), 'History navigation drift')
    allowed_button_attrs = set(expected_action) | {'margin', 'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom', 'color', 'size', 'borderColor', 'borderWidth', 'bgColor', 'bgColorType', 'cornerRadius'}
    require(set(button.attrib) <= allowed_button_attrs, 'No query, record selector, URL or extra action may be added')
    require(packet['originalComponentOrder'] == ORIGINAL_COMPONENTS and packet['savedRows'] == EXPECTED_ROWS, 'Component/order preservation drift')
    expected_components = dict(zip([f'panel_{i}' for i in range(1, 9)], ['operations-header.zml', *(r[0] for r in EXPECTED_MAPPINGS), 'all-company-requests.zml']))
    require(packet['nativeComponents'] == expected_components, 'Native component binding drift')
    require(packet['preservedReports'] == [
        {'component': 'report_1', 'source': 'All_Company_Settings_Requests'},
        {'component': 'report_4', 'source': 'All_Subscriptions', 'title': 'Subscription attention'},
        {'component': 'report_3', 'source': 'All_Account_Services', 'title': 'Provisioning attention'},
        {'component': 'report_2', 'source': 'All_Billing_Webhook_Events', 'title': 'Development billing failures'}], 'All four reports must be retained')
    require(packet['preservedChart'] == {'component': 'chart_1', 'source': 'Account_Services', 'kind': 'bar', 'title': 'Service records by provisioning status'}, 'Chart retention drift')
    queue = packet['pendingQueue']
    require(queue == {'component': 'report_1', 'previousTitle': '', 'title': 'Pending company changes', 'criteria': 'Status == "Pending review"', 'criteriaChanged': False, 'historyPanel': 'panel_8', 'historySource': 'all-company-requests.zml', 'sharedReportChanged': False, 'sharedReportCriteriaObserved': None, 'statusChoicesObserved': ['Pending review'], 'controls': CONTROLS}, 'Queue binding/filter/control drift')
    unqualified = ['nonemptyCounts', 'nonpendingRows', 'errorVersusZero', 'realNativeDeviceExecution', 'clientTenantIsolation', 'broaderStaffAccess', 'productionPublished']
    require(all(packet['qualification'][k] is False for k in unqualified), 'Qualification cannot be broadened by source checks')
    return {'result': 'source-and-preservation-checks-passed', 'xmlSources': 8, 'exactLegacyAggregateMappings': 6,
            'preservedReports': 4, 'preservedCharts': 1, 'byteExactRollback': True,
            'freshRuntimeAttestation': False, 'productionOrClientAccessQualified': False}


if __name__ == '__main__':
    print(json.dumps(verify(), indent=2))
