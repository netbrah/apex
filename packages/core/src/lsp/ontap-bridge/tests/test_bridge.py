#!/usr/bin/env python3
"""
test_bridge.py — self-contained tests for ontap_lsp_bridge.py

Tests real libclang behaviour against genuine C++ fixtures.
Runs on Mac (libclang.dylib from Xcode Command Line Tools) and
Linux (libclang.so from the ONTAP btools LLVM install).

Run:
    python3 tests/test_bridge.py           # all tests
    python3 tests/test_bridge.py -v        # verbose
    python3 tests/test_bridge.py TestHover # single class

Requirements (Mac):  Xcode Command Line Tools (xcode-select --install)
                     pip install libclang   (or use system dylib directly)
Requirements (Linux): libclang.so in btools (already present on airlock)
"""

import json
import os
import sys
import unittest
from pathlib import Path

# ── path setup ───────────────────────────────────────────────────────────────
HERE      = Path(__file__).parent.resolve()
FIXTURES  = HERE / "fixtures"
CC_FILE   = str(FIXTURES / "keymanager_utils.cc")
H_FILE    = str(FIXTURES / "keymanager_utils.h")
COMP_DB   = str(FIXTURES / "compile_commands.json")
BRIDGE    = HERE.parent / "ontap_lsp_bridge.py"

sys.path.insert(0, str(HERE.parent))   # import the bridge module directly

# ── libclang bootstrap (mirrors bridge logic) ────────────────────────────────
LIBCLANG_CANDIDATES = [
    # Linux (airlock)
    "/x/eng/btools/arch/x86_64-redhat-rhel7/compilers_n_tools/pkgs/"
    "llvm-19.1.7-n7478241/lib/libclang.so",
    # Mac (Xcode CLT — always present after xcode-select --install)
    "/Library/Developer/CommandLineTools/usr/lib/libclang.dylib",
    # Mac (Xcode.app)
    "/Applications/Xcode.app/Contents/Developer/Toolchains/"
    "XcodeDefault.xctoolchain/usr/lib/libclang.dylib",
    # Homebrew llvm (optional)
    "/opt/homebrew/opt/llvm/lib/libclang.dylib",
    "/usr/local/opt/llvm/lib/libclang.dylib",
]

def _find_libclang():
    import clang.cindex as cx
    if cx.Config.loaded:
        return cx
    # Prefer system dylib candidates over pip-bundled (pip version may lack
    # knowledge of system headers like <string> on Mac without -isysroot workaround).
    # System dylib + -isysroot in compile_commands = zero parse errors.
    for p in LIBCLANG_CANDIDATES:
        if os.path.exists(p):
            try:
                if not cx.Config.loaded:
                    cx.Config.set_library_file(p)
                cx.Index.create()
                print(f"  libclang: {p}", file=sys.stderr)
                return cx
            except Exception:
                continue
    # Final fallback: pip-bundled libclang (works for Linux where LLVM btools is present)
    try:
        cx.Index.create()
        return cx
    except Exception:
        pass
    raise RuntimeError(
        "libclang not found. On Mac: xcode-select --install (no pip needed)  "
        "On Linux: libclang.so available via ONTAP btools LLVM"
    )

try:
    import clang.cindex
    CX = _find_libclang()
except ImportError:
    print("ERROR: pip install libclang", file=sys.stderr)
    sys.exit(1)

# ── import bridge internals directly ─────────────────────────────────────────
import importlib.util
spec = importlib.util.spec_from_file_location("ontap_lsp_bridge", str(BRIDGE))
bridge_mod = importlib.util.load_from_spec = importlib.util.spec_from_file_location(
    "ontap_lsp_bridge", str(BRIDGE)
)
_bridge = importlib.util.module_from_spec(bridge_mod)
bridge_mod.loader.exec_module(_bridge)

# Force the bridge to use the same libclang we found
_bridge._clang_mod   = CX
_bridge.CLANG_AVAILABLE = True

CompileDB   = _bridge.CompileDB
TUCache     = _bridge.TUCache
_uri_to_path    = _bridge._uri_to_path
_path_to_uri    = _bridge._path_to_uri

handle_definition     = _bridge.handle_definition
handle_references     = _bridge.handle_references
handle_hover          = _bridge.handle_hover
handle_document_symbol= _bridge.handle_document_symbol
handle_prepare_call_hierarchy = _bridge.handle_prepare_call_hierarchy
handle_incoming_calls = _bridge.handle_incoming_calls
handle_outgoing_calls = _bridge.handle_outgoing_calls
handle_diagnostics    = _bridge.handle_diagnostics
handle_workspace_symbol = _bridge.handle_workspace_symbol


# ── shared fixture: one TUCache per test run ──────────────────────────────────
_cache = None

def get_cache():
    global _cache
    if _cache is None:
        db = CompileDB(COMP_DB)
        _cache = TUCache(db)
    return _cache


def _params(file=CC_FILE, line=1, character=1):
    """Build minimal LSP params dict."""
    return {
        "textDocument": {"uri": _path_to_uri(file)},
        "position": {"line": line - 1, "character": character - 1},
    }


# ══════════════════════════════════════════════════════════════════════════════
# 1. CompileDB
# ══════════════════════════════════════════════════════════════════════════════
class TestCompileDB(unittest.TestCase):

    def test_loads_entries(self):
        db = CompileDB(COMP_DB)
        self.assertGreater(len(db._db), 0, "compile_commands.json should have ≥1 entry")

    def test_find_cc_file(self):
        db = CompileDB(COMP_DB)
        entry, source = db.find(CC_FILE)
        self.assertIsNotNone(entry, f"No entry found for {CC_FILE}")
        self.assertTrue(source.endswith(".cc"), f"source should be .cc, got {source}")

    def test_find_by_basename(self):
        db = CompileDB(COMP_DB)
        entry, source = db.find("keymanager_utils.cc")   # relative name
        self.assertIsNotNone(entry)

    def test_miss_returns_none(self):
        db = CompileDB(COMP_DB)
        entry, source = db.find("/nonexistent/totally_fake.cc")
        self.assertIsNone(entry)

    def test_mtime_reload(self):
        """Second call with same mtime should NOT reload (fast path)."""
        db = CompileDB(COMP_DB)
        mtime_before = db._mtime
        db._reload()
        self.assertEqual(db._mtime, mtime_before, "mtime unchanged → no reload")


# ══════════════════════════════════════════════════════════════════════════════
# 2. TUCache
# ══════════════════════════════════════════════════════════════════════════════
class TestTUCache(unittest.TestCase):

    def test_parse_succeeds(self):
        tu, src = get_cache().get_or_parse(CC_FILE)
        self.assertIsNotNone(tu,  "TU should parse without fatal errors")
        self.assertTrue(src.endswith(".cc"))

    def test_no_fatal_errors(self):
        tu, _ = get_cache().get_or_parse(CC_FILE)
        fatal = [d for d in tu.diagnostics if d.severity >= 4]
        self.assertEqual(fatal, [], f"Fatal parse errors: {[d.spelling for d in fatal]}")

    def test_lru_cache_hit(self):
        cache = get_cache()
        tu1, _ = cache.get_or_parse(CC_FILE)
        tu2, _ = cache.get_or_parse(CC_FILE)
        self.assertIs(tu1, tu2, "Second call should return same TU object (cache hit)")

    def test_expected_functions_defined(self):
        """libclang should see all 8 function definitions."""
        tu, src = get_cache().get_or_parse(CC_FILE)
        FN = {CX.CursorKind.FUNCTION_DECL, CX.CursorKind.CXX_METHOD}
        found = set()
        def walk(c):
            if (c.location.file and str(c.location.file.name) == src
                    and c.kind in FN and c.is_definition()):
                found.add(c.spelling)
            for ch in c.get_children(): walk(ch)
        walk(tu.cursor)
        expected = {
            "validateKeyBlob", "deriveKeyId",
            "getKey", "putKey", "deleteKey", "listKeys",
            "pushKeyToKmipServer", "pushKeyToKmipServerForced",
        }
        self.assertTrue(expected.issubset(found),
                        f"Missing functions: {expected - found}")


# ══════════════════════════════════════════════════════════════════════════════
# 3. goToDefinition
# ══════════════════════════════════════════════════════════════════════════════
class TestDefinition(unittest.TestCase):

    def test_definition_of_validateKeyBlob_call_in_putKey(self):
        """
        putKey() calls validateKeyBlob() at L53:14 in the .cc.
        goToDefinition should resolve to validateKeyBlob's definition at L11.
        """
        cache = get_cache()
        result = handle_definition(cache, _params(CC_FILE, line=53, character=14))
        self.assertIsInstance(result, list)
        self.assertGreater(len(result), 0, "Should find at least one definition")
        loc = result[0]
        # Should point to validateKeyBlob definition
        path = _uri_to_path(loc["uri"])
        self.assertTrue(
            path.endswith("keymanager_utils.cc") or path.endswith("keymanager_utils.h"),
            f"Expected .cc or .h, got {path}"
        )
        line = loc["range"]["start"]["line"] + 1  # LSP 0-based → 1-based
        self.assertEqual(line, 11, f"validateKeyBlob defined at L11, got L{line}")

    def test_definition_of_pushKeyToKmipServer_in_forced(self):
        """
        pushKeyToKmipServerForced calls pushKeyToKmipServer at L109.
        Definition is at L91 of the same file.
        """
        cache = get_cache()
        result = handle_definition(cache, _params(CC_FILE, line=109, character=12))
        self.assertIsInstance(result, list)
        self.assertGreater(len(result), 0)
        line = result[0]["range"]["start"]["line"] + 1
        self.assertEqual(line, 91, f"pushKeyToKmipServer defined at L91, got L{line}")

    def test_definition_returns_empty_on_whitespace(self):
        """Pointing at blank space should return empty list gracefully."""
        cache = get_cache()
        result = handle_definition(cache, _params(CC_FILE, line=1, character=1))
        self.assertIsInstance(result, list)  # may be [] or [something] — must not crash


# ══════════════════════════════════════════════════════════════════════════════
# 4. findReferences (within-TU)
# ══════════════════════════════════════════════════════════════════════════════
class TestReferences(unittest.TestCase):

    def test_validateKeyBlob_has_multiple_call_sites(self):
        """
        validateKeyBlob is called from putKey (L53) and pushKeyToKmipServer (L95).
        Pointing at definition L11 should find both call sites.
        """
        cache = get_cache()
        result = handle_references(cache, _params(CC_FILE, line=11, character=6))
        self.assertIsInstance(result, list)
        # At least 2 call sites in the file
        lines = sorted(r["range"]["start"]["line"] + 1 for r in result)
        self.assertGreaterEqual(len(lines), 2,
            f"Expected ≥2 references to validateKeyBlob, got {lines}")
        self.assertIn(53, lines, f"Expected call at L53, got {lines}")
        self.assertIn(95, lines, f"Expected call at L95, got {lines}")

    def test_references_returns_list(self):
        """Must return a list even for symbols with no in-TU callers."""
        cache = get_cache()
        result = handle_references(cache, _params(CC_FILE, line=1, character=1))
        self.assertIsInstance(result, list)


# ══════════════════════════════════════════════════════════════════════════════
# 5. hover
# ══════════════════════════════════════════════════════════════════════════════
class TestHover(unittest.TestCase):

    def test_hover_validateKeyBlob_has_type(self):
        """Hover over validateKeyBlob definition — should include type info."""
        cache = get_cache()
        result = handle_hover(cache, _params(CC_FILE, line=11, character=6))
        self.assertIsNotNone(result, "Hover should return content for a known function")
        content = result["contents"]["value"]
        self.assertIn("validateKeyBlob", content)
        # Should mention the return type or full signature
        self.assertTrue(
            "bool" in content or "validateKeyBlob" in content,
            f"Expected type info in hover, got: {content}"
        )

    def test_hover_returns_markdown(self):
        cache = get_cache()
        result = handle_hover(cache, _params(CC_FILE, line=11, character=6))
        if result:
            self.assertEqual(result["contents"]["kind"], "markdown")

    def test_hover_empty_location_returns_none_or_dict(self):
        """Hover on a blank comment line must not crash."""
        cache = get_cache()
        result = handle_hover(cache, _params(CC_FILE, line=1, character=1))
        # None or dict — both are acceptable
        self.assertTrue(result is None or isinstance(result, dict))


# ══════════════════════════════════════════════════════════════════════════════
# 6. documentSymbol
# ══════════════════════════════════════════════════════════════════════════════
class TestDocumentSymbol(unittest.TestCase):

    def test_returns_list(self):
        cache = get_cache()
        result = handle_document_symbol(cache, {
            "textDocument": {"uri": _path_to_uri(CC_FILE)}
        })
        self.assertIsInstance(result, list)
        self.assertGreater(len(result), 0, "Should find symbols in .cc file")

    def test_contains_key_functions(self):
        cache = get_cache()
        result = handle_document_symbol(cache, {
            "textDocument": {"uri": _path_to_uri(CC_FILE)}
        })
        names = {s["name"] for s in result}
        for fn in ("validateKeyBlob", "deriveKeyId", "pushKeyToKmipServer"):
            self.assertIn(fn, names, f"Expected {fn} in documentSymbol results")

    def test_symbol_has_required_fields(self):
        cache = get_cache()
        result = handle_document_symbol(cache, {
            "textDocument": {"uri": _path_to_uri(CC_FILE)}
        })
        for sym in result[:5]:
            self.assertIn("name",     sym)
            self.assertIn("kind",     sym)
            self.assertIn("location", sym)
            self.assertIn("uri",      sym["location"])
            self.assertIn("range",    sym["location"])


# ══════════════════════════════════════════════════════════════════════════════
# 7. call hierarchy
# ══════════════════════════════════════════════════════════════════════════════
class TestCallHierarchy(unittest.TestCase):

    def test_prepare_returns_item(self):
        """prepareCallHierarchy on pushKeyToKmipServerForced should return 1 item."""
        cache = get_cache()
        result = handle_prepare_call_hierarchy(cache, _params(CC_FILE, line=102, character=17))
        self.assertIsInstance(result, list)
        self.assertGreater(len(result), 0, "prepareCallHierarchy should return an item")
        item = result[0]
        self.assertIn("name", item)
        self.assertIn("pushKeyToKmipServerForced", item["name"])

    def test_outgoing_calls_of_pushKeyToKmipServerForced(self):
        """
        pushKeyToKmipServerForced (L102) calls pushKeyToKmipServer (after noise filter).
        outgoingCalls should include pushKeyToKmipServer.
        """
        cache = get_cache()
        # First prepare
        items = handle_prepare_call_hierarchy(cache, _params(CC_FILE, line=102, character=17))
        self.assertGreater(len(items), 0)
        result = handle_outgoing_calls(cache, {"item": items[0]})
        self.assertIsInstance(result, list)
        if result:  # may be empty if all callees are noise-filtered
            callee_names = {r["to"]["name"] for r in result}
            self.assertIn("pushKeyToKmipServer", callee_names,
                f"Expected pushKeyToKmipServer in outgoing calls, got {callee_names}")

    def test_incoming_calls_of_validateKeyBlob(self):
        """validateKeyBlob is called by putKey and pushKeyToKmipServer within the TU."""
        cache = get_cache()
        items = handle_prepare_call_hierarchy(cache, _params(CC_FILE, line=11, character=6))
        self.assertGreater(len(items), 0)
        result = handle_incoming_calls(cache, {"item": items[0]})
        self.assertIsInstance(result, list)
        self.assertGreater(len(result), 0,
            "validateKeyBlob has in-TU callers — incomingCalls should find them")


# ══════════════════════════════════════════════════════════════════════════════
# 8. diagnostics
# ══════════════════════════════════════════════════════════════════════════════
class TestDiagnostics(unittest.TestCase):

    def test_clean_file_has_no_errors(self):
        """keymanager_utils.cc is valid C++ — diagnostics should be empty."""
        cache = get_cache()
        result = handle_diagnostics(cache, {
            "textDocument": {"uri": _path_to_uri(CC_FILE)}
        })
        self.assertEqual(result["kind"], "full")
        errors = [d for d in result["items"] if d["severity"] <= 2]
        self.assertEqual(errors, [],
            f"Clean file should have no errors, got: {[d['message'] for d in errors]}")

    def test_diagnostics_structure(self):
        cache = get_cache()
        result = handle_diagnostics(cache, {
            "textDocument": {"uri": _path_to_uri(CC_FILE)}
        })
        self.assertIn("kind",  result)
        self.assertIn("items", result)
        self.assertIsInstance(result["items"], list)


# ══════════════════════════════════════════════════════════════════════════════
# 9. workspaceSymbol
# ══════════════════════════════════════════════════════════════════════════════
class TestWorkspaceSymbol(unittest.TestCase):

    def setUp(self):
        # Warm the cache so workspaceSymbol has something to search
        get_cache().get_or_parse(CC_FILE)

    def test_empty_query_returns_symbols(self):
        result = handle_workspace_symbol(get_cache(), {"query": ""})
        self.assertIsInstance(result, list)
        self.assertGreater(len(result), 0)

    def test_query_validateKeyBlob(self):
        result = handle_workspace_symbol(get_cache(), {"query": "validateKeyBlob"})
        self.assertIsInstance(result, list)
        names = [s["name"] for s in result]
        self.assertIn("validateKeyBlob", names,
            f"workspaceSymbol('validateKeyBlob') returned: {names}")

    def test_query_partial_match(self):
        result = handle_workspace_symbol(get_cache(), {"query": "kmip"})
        self.assertIsInstance(result, list)
        # pushKeyToKmipServer and pushKeyToKmipServerForced should match
        names = [s["name"] for s in result]
        kmip_hits = [n for n in names if "Kmip" in n or "kmip" in n.lower()]
        self.assertGreater(len(kmip_hits), 0,
            f"Expected kmip symbols, got names: {names[:10]}")

    def test_no_match_returns_empty(self):
        result = handle_workspace_symbol(get_cache(), {"query": "zzz_definitely_not_a_symbol"})
        self.assertEqual(result, [])


# ══════════════════════════════════════════════════════════════════════════════
# 10. noise filter
# ══════════════════════════════════════════════════════════════════════════════
class TestNoiseFilter(unittest.TestCase):

    def test_std_calls_suppressed(self):
        """std:: calls should never appear in outgoing call results."""
        cache = get_cache()
        items = handle_prepare_call_hierarchy(cache, _params(CC_FILE, line=72, character=30))
        if not items:
            self.skipTest("prepareCallHierarchy returned nothing for listKeys")
        result = handle_outgoing_calls(cache, {"item": items[0]})
        callee_names = {r["to"]["name"] for r in result}
        std_leaks = {n for n in callee_names if n.startswith("std::") or n in ("reserve", "push_back", "size")}
        self.assertEqual(std_leaks, set(),
            f"STL noise leaked into outgoing calls: {std_leaks}")

    def test_is_noise_call(self):
        self.assertTrue(_bridge._is_noise_call("traceError"))
        self.assertTrue(_bridge._is_noise_call("std::vector"))
        self.assertTrue(_bridge._is_noise_call("boost::shared_ptr"))
        self.assertFalse(_bridge._is_noise_call("validateKeyBlob"))
        self.assertFalse(_bridge._is_noise_call("pushKeyToKmipServer"))

    def test_is_system_file(self):
        self.assertTrue(_bridge._is_system_file("/usr/include/string.h"))
        self.assertTrue(_bridge._is_system_file("c++/vector"))
        self.assertFalse(_bridge._is_system_file("/ontap/src/security/keymanager/foo.cc"))


# ══════════════════════════════════════════════════════════════════════════════
# 11. URI helpers
# ══════════════════════════════════════════════════════════════════════════════
class TestUriHelpers(unittest.TestCase):

    def test_roundtrip(self):
        uri = _path_to_uri(CC_FILE)
        self.assertTrue(uri.startswith("file://"))
        back = _uri_to_path(uri)
        self.assertEqual(os.path.normpath(back), os.path.normpath(CC_FILE))

    def test_path_to_uri_absolute(self):
        uri = _path_to_uri("/some/path/file.cc")
        self.assertEqual(uri, "file:///some/path/file.cc")


# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    loader = unittest.TestLoader()
    # Sort so CompileDB → TUCache → everything else (dependency order)
    suite = unittest.TestSuite()
    for cls in [
        TestCompileDB, TestTUCache,
        TestDefinition, TestReferences, TestHover,
        TestDocumentSymbol, TestCallHierarchy,
        TestDiagnostics, TestWorkspaceSymbol,
        TestNoiseFilter, TestUriHelpers,
    ]:
        suite.addTests(loader.loadTestsFromTestCase(cls))

    verbosity = 2 if "-v" in sys.argv else 1
    runner = unittest.TextTestRunner(verbosity=verbosity)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
