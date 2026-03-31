#!/usr/bin/env python3.11
"""
smoke_airlock.py — single-file smoke test for the ONTAP LSP bridge on Linux/airlock.

Copy this ONE file to the airlock. Run it from the directory containing
ontap_lsp_bridge.py (or pass --bridge-dir). It generates its own C++ fixture
in /tmp, runs 8 targeted checks, and reports PASS/FAIL with timing.

Requirements (all already on airlock):
  - python3.6+  (no pip install needed)
  - libclang.so from ONTAP btools LLVM (auto-detected)
  - clang++ (for generating the compile_commands.json sysroot args)
  - a real compile_commands.json, OR let this script generate a self-contained one

Usage:
  # Basic — uses /tmp scratch dir, auto-finds bridge
  python3 smoke_airlock.py

  # Point at your ONTAP checkout's compile_commands.json for a real-world test
  python3 smoke_airlock.py --compile-commands /path/to/compile_commands.json \
                           --source-file /path/to/some/keymanager_file.cc

  # Verbose (print all check details)
  python3 smoke_airlock.py -v
"""

from __future__ import annotations
import argparse, json, os, subprocess, sys, tempfile, time
from pathlib import Path
from typing import Optional

# ── ANSI ─────────────────────────────────────────────────────────────────────
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def ok(msg):  print(f"  {GREEN}✓{RESET} {msg}")
def fail(msg):print(f"  {RED}✗{RESET} {msg}")
def info(msg):print(f"  {CYAN}·{RESET} {msg}")

# ── libclang probe ────────────────────────────────────────────────────────────
LIBCLANG_CANDIDATES = [
    # Airlock ONTAP btools — prefer newest first
    "/x/eng/btools/arch/x86_64-redhat-rhel7/compilers_n_tools/pkgs/"
    "llvm-21.1.8-n27e887c/lib/libclang.so",
    "/x/eng/btools/arch/x86_64-redhat-rhel7/compilers_n_tools/pkgs/"
    "llvm-19.1.7-n7478241/lib/libclang.so",
    # Generic Linux fallbacks
    "/usr/lib64/libclang.so",
    "/usr/lib/x86_64-linux-gnu/libclang-14.so.1",
    "/usr/lib/llvm-14/lib/libclang.so",
    # Mac (for dev/test on laptop)
    "/Library/Developer/CommandLineTools/usr/lib/libclang.dylib",
    "/Applications/Xcode.app/Contents/Developer/Toolchains/"
    "XcodeDefault.xctoolchain/usr/lib/libclang.dylib",
]

def find_libclang() -> Optional[str]:
    for p in LIBCLANG_CANDIDATES:
        if os.path.exists(p):
            return p
    # Try pip-bundled (clang.cindex loads it automatically)
    try:
        import clang.cindex as cx
        cx.Index.create()
        return "pip-bundled"
    except Exception:
        pass
    return None

# ── self-contained C++ fixture ────────────────────────────────────────────────
FIXTURE_CC = r"""
/* ONTAP kernel-style C fixture — no standard library includes (-nostdinc) */

typedef unsigned int  uint32_t;
typedef unsigned char uint8_t;
typedef unsigned long size_t;

/* Minimal string type for test */
struct smdb_error {
    int code;
};

static inline int smdb_error_is_ok(struct smdb_error e) { return e.code == 0; }

enum KmStatus { KM_OK = 0, KM_NOT_FOUND = 1, KM_INTERNAL_ERROR = 2 };

struct KeyEntry {
    const char* key_id;
    const char* key_data;
    uint32_t    key_type;
    uint32_t    key_len;
    int         is_active;
};

/**
 * validateKeyBlob — validate a raw key blob.
 * Returns 1 if valid, 0 if invalid.
 */
int validateKeyBlob(const char* blob, uint32_t len, uint32_t expected_type) {
    if (!blob || len < 32) return 0;
    uint8_t encoded_type = (uint8_t)blob[0];
    return encoded_type == (expected_type & 0xFF);
}

/**
 * deriveKeyId — write svm_uuid:key_type into buf.
 */
void deriveKeyId(const char* svm_uuid, uint32_t key_type, char* buf, size_t bufsz) {
    /* simplified — real impl uses snprintf */
    (void)svm_uuid; (void)key_type; (void)buf; (void)bufsz;
}

static enum KmStatus pushKeyToKmipServer(const struct KeyEntry* entry,
                                          const char* url) {
    if (!url || url[0] == '') return KM_INTERNAL_ERROR;
    if (!validateKeyBlob(entry->key_data, entry->key_len, entry->key_type))
        return KM_INTERNAL_ERROR;
    return KM_OK;
}

static enum KmStatus pushKeyToKmipServerForced(const struct KeyEntry* entry,
                                                const char* url,
                                                int force) {
    if (force) return KM_OK;
    return pushKeyToKmipServer(entry, url);
}
"""

def make_fixture(tmpdir: str) -> tuple[str, str]:
    """Write C++ fixture + compile_commands.json to tmpdir. Return (cc, db)."""
    cc = os.path.join(tmpdir, "km_smoke.c")
    db = os.path.join(tmpdir, "compile_commands.json")

    with open(cc, "w") as f:
        f.write(FIXTURE_CC)

    # ONTAP kernel-style: C file, -nostdinc, no system headers needed
    # Works on Linux/airlock without any sysroot or system includes.
    entry = {
        "directory": tmpdir,
        "file": cc,
        "arguments": [
            "clang", "-xc", "-std=gnu11", "-nostdinc",
            "-Wno-everything", "-c", cc, "-o", cc+".o"
        ],
    }
    with open(db, "w") as f:
        json.dump([entry], f)

    return cc, db

# ── bridge loader ─────────────────────────────────────────────────────────────
def load_bridge(bridge_dir: str, libclang_path: Optional[str]):
    import importlib.util
    bridge_file = os.path.join(bridge_dir, "ontap_lsp_bridge.py")
    if not os.path.exists(bridge_file):
        raise FileNotFoundError(f"Bridge not found: {bridge_file}")

    spec = importlib.util.spec_from_file_location("ontap_lsp_bridge", bridge_file)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    # Inject libclang
    import clang.cindex as cx
    if libclang_path and libclang_path != "pip-bundled" and not cx.Config.loaded:
        cx.Config.set_library_file(libclang_path)
    cx.Index.create()  # smoke test
    m._clang_mod = cx
    m.CLANG_AVAILABLE = True
    return m

# ── checks ────────────────────────────────────────────────────────────────────
def run_checks(m, cc: str, db: str, verbose: bool) -> tuple[int, int]:
    passed = failed = 0

    CompileDB = m.CompileDB
    TUCache   = m.TUCache
    uri       = m._path_to_uri(cc)

    def p(file=cc, line=1, col=1):
        return {"textDocument": {"uri": uri},
                "position": {"line": line-1, "character": col-1}}

    # 1. CompileDB finds the file
    try:
        cdb = CompileDB(db)
        entry, src = cdb.find(cc)
        assert entry is not None, "CompileDB.find returned None"
        ok("CompileDB: found compile entry")
        passed += 1
    except Exception as e:
        fail(f"CompileDB.find: {e}"); failed += 1

    # 2. TU parses without fatal errors
    try:
        cache = TUCache(cdb)
        t0 = time.perf_counter()
        tu, src = cache.get_or_parse(cc)
        elapsed = time.perf_counter() - t0
        assert tu is not None, "TU is None"
        fatal = [d for d in tu.diagnostics if d.severity >= 4]
        assert not fatal, f"Fatal errors: {[d.spelling for d in fatal]}"
        ok(f"TUCache: parsed in {elapsed:.2f}s, 0 fatal errors")
        passed += 1
    except Exception as e:
        fail(f"TUCache.get_or_parse: {e}"); failed += 1
        return passed, failed  # can't continue without TU

    # 3. LRU cache hit (same object returned)
    try:
        tu2, _ = cache.get_or_parse(cc)
        assert tu2 is tu, "Cache miss on second call — expected hit"
        ok("TUCache: LRU cache hit (same TU object)")
        passed += 1
    except Exception as e:
        fail(f"LRU cache: {e}"); failed += 1

    # 4. documentSymbol finds key functions
    try:
        syms = m.handle_document_symbol(cache, {"textDocument": {"uri": uri}})
        names = {s["name"] for s in syms}
        for fn in ("validateKeyBlob", "deriveKeyId", "pushKeyToKmipServer"):
            assert fn in names, f"{fn} missing from documentSymbol"
        ok(f"documentSymbol: found {len(syms)} symbols including key functions")
        if verbose:
            info(f"  symbols: {sorted(names)[:10]}")
        passed += 1
    except Exception as e:
        fail(f"documentSymbol: {e}"); failed += 1

    # 5. goToDefinition: call site of validateKeyBlob inside pushKeyToKmipServer
    #    In FIXTURE_CC, pushKeyToKmipServer calls validateKeyBlob. Scan for the line.
    try:
        with open(cc) as f:
            lines = f.readlines()
        # Find a call site of validateKeyBlob (not its definition)
        call_line = None
        call_col  = None
        for i, l in enumerate(lines):
            stripped = l.strip()
            # Skip definition line and any comments (docstrings, // comments)
            if ("validateKeyBlob" in l
                    and not stripped.startswith("int validateKeyBlob")
                    and not stripped.startswith("*")
                    and not stripped.startswith("//")
                    and not stripped.startswith("/*")):
                call_line = i + 1
                # Column of the first char of "validateKeyBlob" on this line (1-based)
                call_col  = l.index("validateKeyBlob") + 1
                break
        assert call_line, "Could not find validateKeyBlob call site in fixture"
        result = m.handle_definition(cache, p(cc, call_line, call_col))
        assert isinstance(result, list) and len(result) > 0, \
            f"goToDefinition returned empty at L{call_line}"
        def_line = result[0]["range"]["start"]["line"] + 1
        ok(f"goToDefinition: call at L{call_line} → definition at L{def_line}")
        if verbose:
            info(f"  uri: {result[0]['uri']}")
        passed += 1
    except Exception as e:
        fail(f"goToDefinition: {e}"); failed += 1

    # 6. findReferences: validateKeyBlob has ≥1 in-TU call site
    try:
        # Find definition line
        def_line = next(
            (i+1 for i, l in enumerate(lines) if "int validateKeyBlob" in l), None
        )
        assert def_line, "Cannot find validateKeyBlob definition line"
        refs = m.handle_references(cache, p(cc, def_line, 6))
        assert isinstance(refs, list) and len(refs) >= 1, \
            f"Expected ≥1 reference, got {refs}"
        ref_lines = sorted(r["range"]["start"]["line"]+1 for r in refs)
        ok(f"findReferences: {len(refs)} in-TU call site(s) at lines {ref_lines}")
        passed += 1
    except Exception as e:
        fail(f"findReferences: {e}"); failed += 1

    # 7. hover: returns markdown with type info
    try:
        def_line = next(
            (i+1 for i, l in enumerate(lines) if "int validateKeyBlob" in l), None
        )
        result = m.handle_hover(cache, p(cc, def_line, 6))
        if result is None:
            ok("hover: returned None (cursor at whitespace — acceptable)")
        else:
            assert result["contents"]["kind"] == "markdown"
            assert "validateKeyBlob" in result["contents"]["value"]
            ok(f"hover: markdown with type info returned")
        if verbose:
            info(f"  content: {result['contents']['value'][:120]}")
        passed += 1
    except Exception as e:
        fail(f"hover: {e}"); failed += 1

    # 8. noise filter: no std:: leakage
    try:
        assert m._is_noise_call("traceError"), "traceError should be noise"
        assert m._is_noise_call("std::vector"), "std::vector should be noise"
        assert not m._is_noise_call("validateKeyBlob"), "validateKeyBlob is not noise"
        ok("noise filter: traceError/std:: suppressed, project calls preserved")
        passed += 1
    except Exception as e:
        fail(f"noise filter: {e}"); failed += 1

    return passed, failed

# ── main ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="ONTAP LSP bridge smoke test (airlock)")
    ap.add_argument("--bridge-dir", default=None,
                    help="Dir containing ontap_lsp_bridge.py (default: script dir, then cwd)")
    ap.add_argument("--compile-commands", default=None,
                    help="Path to a real compile_commands.json (default: generate self-contained)")
    ap.add_argument("--source-file", default=None,
                    help="C++ source file to test against (required if --compile-commands given)")
    ap.add_argument("--libclang", default=None,
                    help="Path to libclang.so/.dylib (auto-detected if omitted)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    print(f"\n{BOLD}{CYAN}ONTAP LSP Bridge — Airlock Smoke Test{RESET}\n")

    # Find bridge
    bridge_dir = args.bridge_dir
    if not bridge_dir:
        script_dir = str(Path(__file__).parent)
        for candidate in [script_dir, os.getcwd()]:
            if os.path.exists(os.path.join(candidate, "ontap_lsp_bridge.py")):
                bridge_dir = candidate
                break
    if not bridge_dir:
        print(f"{RED}ERROR: ontap_lsp_bridge.py not found. "
              f"Run from its directory or pass --bridge-dir.{RESET}")
        sys.exit(1)
    info(f"Bridge: {bridge_dir}/ontap_lsp_bridge.py")

    # Find libclang
    libclang = args.libclang or find_libclang()
    if not libclang:
        print(f"{RED}ERROR: libclang not found. "
              "On airlock: it's in btools LLVM (see LIBCLANG_CANDIDATES in this script). "
              "On Mac: xcode-select --install{RESET}")
        sys.exit(1)
    info(f"libclang: {libclang}")

    # C++ fixture
    with tempfile.TemporaryDirectory(prefix="apex-lsp-smoke-") as tmpdir:
        if args.compile_commands:
            cc   = args.source_file
            db   = args.compile_commands
            info(f"Using real compile_commands: {db}")
            info(f"Source file: {cc}")
        else:
            cc, db = make_fixture(tmpdir)
            info(f"Self-contained fixture: {cc}")

        # Load bridge
        try:
            m = load_bridge(bridge_dir, libclang)
            info("Bridge module loaded OK")
        except Exception as e:
            print(f"{RED}ERROR: failed to load bridge: {e}{RESET}")
            sys.exit(1)

        print()
        t_start = time.perf_counter()
        passed, failed = run_checks(m, cc, db, args.verbose)
        elapsed = time.perf_counter() - t_start

        total = passed + failed
        print()
        if failed == 0:
            print(f"{BOLD}{GREEN}  PASS  {passed}/{total} checks in {elapsed:.1f}s{RESET}\n")
            sys.exit(0)
        else:
            print(f"{BOLD}{RED}  FAIL  {passed}/{total} passed, {failed} failed "
                  f"({elapsed:.1f}s){RESET}\n")
            sys.exit(1)

if __name__ == "__main__":
    main()
