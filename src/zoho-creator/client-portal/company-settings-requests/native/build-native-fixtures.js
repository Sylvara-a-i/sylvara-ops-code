"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { validateRequestedServiceArea: validate } = require("../service-area-request-contract");

const cases = [];
const literal = (s) => s === "" ? '""' : `hexToText("${Buffer.from(s, "utf8").toString("hex")}")`;
function add(id, raw, expression) {
  let valid = true, expected = "";
  try { expected = validate(raw); } catch { valid = false; }
  cases.push({id, raw, expression: expression || literal(raw), valid, expected});
}
add("blank", "");
add("ascii_spaces", "   ");
add("numeric_text", "123");
add("newlines_and_tab", "  North\r\nSouth\rEast\tWest  ");
add("vt_ff_at_edges", "\v trimmed \f");
add("whitespace_only", " \t\r\n ");
add("crcrlf", "a\r\r\nb");
add("internal_spaces", "a  b");
add("literal_backslash_n", "a\\nb");
add("regex_metacharacters", "a$.*+?[](){}\\^b");
const ws = [9,10,11,12,13,32,160,5760,...Array.from({length:11},(_,i)=>8192+i),8232,8233,8239,8287,12288,65279];
for (const cp of ws) {
  const c = String.fromCodePoint(cp), tag = cp.toString(16).padStart(4,"0");
  add(`trim_${tag}`, c + "x" + c);
  add(`blank_${tag}`, c);
  add(`internal_${tag}`, "a" + c + "b");
}
for (const cp of [...Array.from({length:32},(_,i)=>i),127]) {
  const c = String.fromCharCode(cp), tag = cp.toString(16).padStart(4,"0");
  add(`control_inside_${tag}`, "a" + c + "b");
  add(`control_edges_${tag}`, c + "x" + c);
}
for (const cp of [0x0085,0x180e,0x200b,0x2060]) {
  const c = String.fromCodePoint(cp);
  add(`not_trim_${cp.toString(16)}`, c + "x" + c);
}
for (const [id, unit] of [["ascii","x"],["emoji","😀"]]) {
  for (const count of [2000,2001]) add(`${id}_${count}`, unit.repeat(count), `"${unit}".repeat(${count})`);
}
add("mixed_2000", "x".repeat(1000)+"😀".repeat(1000), '"x".repeat(1000) + "😀".repeat(1000)');
add("mixed_2001", "x".repeat(1000)+"😀".repeat(1000)+"x", '"x".repeat(1000) + "😀".repeat(1000) + "x"');
add("trim_before_limit", "  "+"😀".repeat(2000)+"  ", '"  " + "😀".repeat(2000) + "  "');
add("combining_2000", "e\u0301".repeat(1000), literal("e\u0301")+'.repeat(1000)');
add("combining_2001", "e\u0301".repeat(1000)+"x", literal("e\u0301")+'.repeat(1000) + "x"');
add("zwj_2000", "👩‍💻".repeat(666)+"xx", '"👩‍💻".repeat(666) + "xx"');
add("zwj_2001", "👩‍💻".repeat(667), '"👩‍💻".repeat(667)');
add("flag_count", "🇺🇸");
// Deluge's Java-style $ can match before a final NEL, unlike ECMAScript trim.
// These failed the original native candidate; strict absolute-end \\z is required.
add("space_before_final_nel", "x \u0085");
add("vt_before_final_nel", "x\v\u0085");
add("space_before_final_nel_2001", "x".repeat(1999) + " \u0085", '"x".repeat(1999) + hexToText("20c285")');

function readTransformation() {
  const source = fs.readFileSync(path.join(__dirname, "requested-service-area-on-validate.deluge"), "utf8");
  const lines = source.split("\n").map((line) => line.trim());
  const start = lines.indexOf('bs = hexToText("5c");');
  const normalizeStart = lines.indexOf('normalized = raw.replaceAll(cr + lf,lf,true);');
  const end = lines.indexOf('valid = normalized != "" && without_controls == normalized && marker_count <= 2000;');
  assert.ok(start > 0 && normalizeStart > start && end > normalizeStart);
  const patternInit = lines.slice(start, normalizeStart).join("\n");
  const normalize = lines.slice(normalizeStart, end + 1).join("\n");
  assert.ok(normalize.includes('ws + "+" + bs + "z"'), "Require strict absolute-end anchor");
  assert.ok(!normalize.includes('+$'), "Java-style $ anchor must not return");
  return { source, patternInit, normalize };
}

function makeNativeProbe() {
const { patternInit, normalize } = readTransformation();
const initCases = cases.map(c => {
  const expectedExpr = c.valid ? (c.raw === c.expected ? c.expression : literal(c.expected)) : '""';
  return `fixtures.add({"id":"${c.id}","raw":${c.expression},"valid":${c.valid},"expected":${expectedExpr},"count":${c.valid ? [...c.expected].length : -1}});`;
}).join("\n");
const harness = `// Pure computation only. No form references, calls, sends, save, or record actions.
// Oracle: service-area-request-contract.js at 329d47c4, blob dc24f6414272657abf0ee57e160a019ef5a9590c.
${patternInit}
fixtures = List();
${initCases}
passes = 0;
failures = List();
for each fixture in fixtures
{
    raw = fixture.get("raw");
${normalize.split("\n").map(x=>"    "+x).join("\n")}
    same = valid == fixture.get("valid");
    if(valid && fixture.get("valid"))
    {
        same = same && normalized == fixture.get("expected") && marker_count == fixture.get("count");
    }
    if(same)
    {
        passes = passes + 1;
    }
    else
    {
        failures.add(fixture.get("id"));
    }
}
info "TOTAL=" + fixtures.size();
info "PASS=" + passes;
info "FAIL=" + failures.size();
info failures;
`;
return harness;
}

function checkLocalParity() {
// Verify the explicit character class matches the current JS oracle across all BMP code units.
const whitespace = /[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/u;
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
for(let cp=0;cp<=0xffff;cp++) {
  const c=String.fromCharCode(cp);
  assert.equal(whitespace.test(c), c.trim()==="", `trim set mismatch U+${cp.toString(16)}`);
  assert.equal(controls.test(c), (cp<=8)||(cp===11)||(cp===12)||(cp>=14&&cp<=31)||(cp===127));
}
for (const c of cases) {
  // JS has no \\z; a negative all-character lookahead models absolute end here.
  // This remains a JS parity check, not a claim to emulate the Deluge engine.
  const normalized = c.raw.replace(/\r\n/g,"\n").replace(/\r/g,"\n").replace(/^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/u,"").replace(/[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+(?![\s\S])/u,"");
  const valid=normalized!=="" && !controls.test(normalized) && [...normalized].length<=2000;
  assert.equal(valid,c.valid,c.id);
  if(valid) assert.equal(normalized,c.expected,c.id);
}
return { fixtureCount: cases.length, bmpCodeUnitsChecked: 65536 };
}

module.exports = { cases, readTransformation, makeNativeProbe, checkLocalParity };

if (require.main === module) {
  assert.deepEqual(process.argv.slice(2), ["--emit-tryout"], "Usage: node native/build-native-fixtures.js --emit-tryout");
  checkLocalParity();
  process.stdout.write(makeNativeProbe());
}
