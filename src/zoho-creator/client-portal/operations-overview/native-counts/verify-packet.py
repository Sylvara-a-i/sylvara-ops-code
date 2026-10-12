"""Check proposed native aggregates against existing independent source; no live IO."""
import json
import re
from pathlib import Path
from xml.etree import ElementTree


def verify():
    root = Path(__file__).resolve().parent
    packet = json.loads((root / "packet.json").read_text(encoding="utf-8"))
    baseline = (root / packet["sourceReference"]).read_text(encoding="utf-8")
    queries = re.findall(r"\b(\w+_count)\s*=\s*(\w+)\[(.*?)\]\.count\(\);", baseline)
    assert len(queries) == 6 and len({row[0] for row in queries}) == 6
    existing = {name: (form, criteria) for name, form, criteria in queries}
    assert len(packet["panels"]) == 6
    assert {item["legacyVariable"] for item in packet["panels"]} == set(existing)
    assert {p.name for p in root.glob("*.zml")} == {packet["header"], *(p["file"] for p in packet["panels"])}

    def parse(filename):
        panel = ElementTree.parse(root / filename).getroot()
        assert panel.tag == "panel"
        for node in panel.iter():
            assert node.tag in {"panel", "pr", "pc", "text"}
            assert "action" not in node.attrib
        return panel

    header = parse(packet["header"])
    header_values = [node.get("value") for node in header.iter("text")]
    assert header_values == ["Operations Overview", "Record inventory and review queues."]
    for value in header_values:
        assert value in baseline
    names = {header.get("elementName")}
    for item in packet["panels"]:
        assert existing[item["legacyVariable"]] == (item["form"], item["criteria"])
        assert item["aggregate"] == "ID.count"
        panel = parse(item["file"])
        assert panel.get("elementName") not in names
        names.add(panel.get("elementName"))
        data = [node for node in panel.iter("text") if node.get("type") == "Form Data"]
        assert len(data) == 1
        assert data[0].get("value") == f"{packet['target']['application']}.{item['form']}.ID.count"
        assert data[0].get("criteria") == item["criteria"]
        assert all(node.get("type") in {"Text", "Form Data"} for node in panel.iter("text"))
    return {"xmlSources": 7, "exactLegacyAggregateMappings": 6, "actions": 0,
            "result": "source-checks-passed", "nativeRuntimeQualified": False,
            "staffClientAccessQualified": False, "installed": False}


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
