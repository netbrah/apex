#!/usr/bin/env python3.12
"""
ONTAP LSP Bridge — JSON-RPC stdio server wrapping libclang.

Speaks the LSP wire protocol that APEX's LspConnectionFactory expects.
Plugs in as a configured LSP server via settings.json; zero changes to APEX core.

Architecture:
  APEX LspConnectionFactory (TS) ←─ JSON-RPC/stdio ─→ this server ←─ libclang

Supported methods (all APEX LspTool operations need):
  initialize / initialized / shutdown / exit
  textDocument/didOpen           (warm-up / cache prime — we parse the TU here)
  textDocument/definition        → goToDefinition
  textDocument/references        → findReferences
  textDocument/hover             → hover
  textDocument/documentSymbol    → documentSymbol
  textDocument/implementation    → goToImplementation
  textDocument/prepareCallHierarchy → prepareCallHierarchy
  callHierarchy/incomingCalls    → incomingCalls
  callHierarchy/outgoingCalls    → outgoingCalls
  textDocument/diagnostic        → diagnostics
  workspace/diagnostic           → workspaceDiagnostics
  textDocument/codeAction        → codeActions (no-op, returns [])
  workspace/symbol               → workspaceSymbol (limited: TU-local only)

TU Cache strategy:
  - Parse on first didOpen or first request for a file
  - LRU cache: evict least-recently-used after MAX_CACHED_TUS
  - Each TU parse is the bottleneck (~0.5-3s depending on include depth)
  - Subsequent requests on the same file are instant (cursor traversal only)

ONTAP-specific:
  - .ut → generated .cc mapping (compile_commands entry lookup)
  - Noise filter: traceError/traceDebug/std::/boost:: calls suppressed
  - SMF iterator method detection (_imp suffix)

Usage (from .lsp.json or settings.json):
  command: python3.12
  args: ["/path/to/ontap_lsp_bridge.py",
         "--compile-commands", "/x/path/to/compile_commands.json",
         "--libclang", "/x/eng/.../libclang.so"]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote, urlparse

# ─── logging: stderr only (stdout is the JSON-RPC wire) ─────────────────────
logging.basicConfig(
    stream=sys.stderr,
    level=logging.WARNING,
    format="ontap-lsp %(levelname)s %(message)s",
)
log = logging.getLogger("ontap-lsp")

# ─── libclang bootstrap ──────────────────────────────────────────────────────
CLANG_AVAILABLE = False
_clang_mod = None

DEFAULT_LIBCLANG_PATHS = [
    "/x/eng/btools/arch/x86_64-redhat-rhel7/compilers_n_tools/pkgs/llvm-19.1.7-n7478241/lib/libclang.so",
    "/usr/lib64/libclang.so",
    "/Library/Developer/CommandLineTools/usr/lib/libclang.dylib",
    "/usr/lib/libclang.so",
]

def _init_clang(libclang_path: Optional[str] = None) -> bool:
    global CLANG_AVAILABLE, _clang_mod
    if CLANG_AVAILABLE:
        return True
    try:
        import clang.cindex as cx
        if not cx.Config.loaded:
            candidates = ([libclang_path] if libclang_path else []) + DEFAULT_LIBCLANG_PATHS
            for p in candidates:
                if p and os.path.exists(p):
                    cx.Config.set_library_file(p)
                    log.warning("libclang loaded from %s", p)
                    break
        cx.Index.create()  # smoke test
        _clang_mod = cx
        CLANG_AVAILABLE = True
        return True
    except Exception as exc:
        log.error("libclang init failed: %s", exc)
        return False

# ─── noise filters (match your existing script) ──────────────────────────────
SYSTEM_PATH_PATTERNS = [
    "/usr/include/", "/usr/local/include/", "c++/", "gcc/",
    "clang/", "llvm/", "/lib64/", "/lib/", "/opt/", "stl_", "bits/",
]
UTILITY_CALL_PATTERNS = [
    "toString", "c_str", "operator", "basic_string", "allocator",
    "TracePoint", "TraceEntry", "traceDebug", "traceError", "traceInfo",
    "traceWarn", "traceLog", "traceEntry", "traceExit", "traceExitRet",
    "__builtin", "std::", "boost::",
]

def _is_system_file(path: str) -> bool:
    return not path or any(p in path for p in SYSTEM_PATH_PATTERNS)

def _is_noise_call(callee: str) -> bool:
    return any(p in callee for p in UTILITY_CALL_PATTERNS)

# ─── compile_commands loader + .ut→.cc resolver ──────────────────────────────
class CompileDB:
    """Load and query compile_commands.json with ONTAP .ut mapping."""

    def __init__(self, path: str):
        self.path = path
        self._db: Dict[str, dict] = {}     # abs_file_path → entry
        self._mtime: float = 0.0
        self._lock = threading.Lock()
        self._reload()

    def _reload(self) -> None:
        try:
            mtime = os.path.getmtime(self.path)
            if mtime <= self._mtime:
                return
            with open(self.path) as f:
                entries = json.load(f)
            db: Dict[str, dict] = {}
            for e in entries:
                fp = e.get("file", "")
                if not os.path.isabs(fp):
                    fp = os.path.join(e.get("directory", ""), fp)
                fp = os.path.normpath(fp)
                db[fp] = e
            with self._lock:
                self._db = db
                self._mtime = mtime
            log.warning("compile_commands loaded: %d entries", len(db))
        except Exception as exc:
            log.error("Failed to load compile_commands: %s", exc)

    def find(self, file_path: str) -> Tuple[Optional[dict], str]:
        """
        Return (entry, source_file_to_parse).
        source_file_to_parse may differ from file_path for .ut files
        (points to the generated .cc in bedrock/).
        """
        self._reload()
        with self._lock:
            db = self._db

        norm = os.path.normpath(os.path.abspath(file_path))

        # Direct hit
        if norm in db:
            return db[norm], _get_actual_source(db[norm])

        # Basename fallback (handles relative paths from client)
        base = os.path.basename(norm)
        base_no_ext = re.sub(r'\.(cc|cpp|cxx|ut)$', '', base)
        for key, entry in db.items():
            kb = os.path.basename(key)
            if kb == base:
                return entry, _get_actual_source(entry)
            # .ut → match by stem
            if re.sub(r'\.(cc|cpp|cxx|ut)$', '', kb) == base_no_ext:
                if key.endswith('.ut') or file_path.endswith('.ut'):
                    return entry, _get_actual_source(entry)

        return None, file_path


def _get_actual_source(entry: dict) -> str:
    """
    For .ut files the real source to parse is the generated .cc (args[2]).
    Matches the logic in your existing ClangAstParser.
    """
    file_field = entry.get("file", "")
    args = entry.get("arguments", [])
    if file_field.endswith(".ut") and len(args) > 2:
        for arg in args[1:6]:
            if arg.endswith(".cc") and "bedrock/" in arg:
                return arg
    return file_field


def _extract_minimal_args(args: List[str], directory: str) -> List[str]:
    """Strip compile_commands args down to -I/-D/-std/-isystem flags only."""
    minimal: List[str] = []
    start = 1 if args and any(
        c in os.path.basename(args[0])
        for c in ("clang", "gcc", "g++", "cc", "c++")
    ) else 0
    i = start
    while i < len(args):
        arg = args[i]
        if arg in ("-I", "-isystem", "-D", "-include", "-isysroot"):
            if i + 1 < len(args):
                nxt = args[i + 1]
                if arg in ("-I", "-isystem", "-isysroot") and not os.path.isabs(nxt):
                    nxt = os.path.join(directory, nxt)
                minimal.extend([arg, nxt])
                i += 2
                continue
        elif arg.startswith("-I"):
            p = arg[2:]
            if not os.path.isabs(p):
                p = os.path.join(directory, p)
            minimal.append(f"-I{p}")
        elif arg.startswith(("-D", "-isystem")):
            minimal.append(arg)
        elif arg.startswith("-std="):
            minimal.append(arg)
        i += 1
    return minimal

# ─── TU cache (LRU, thread-safe) ─────────────────────────────────────────────
MAX_CACHED_TUS = 8

class TUCache:
    def __init__(self, compile_db: CompileDB):
        self.db = compile_db
        self._cache: OrderedDict[str, Any] = OrderedDict()  # norm_path → TU
        self._sources: Dict[str, str] = {}                   # norm_path → source file
        self._lock = threading.Lock()

    def get_or_parse(self, file_path: str) -> Tuple[Optional[Any], str]:
        """Return (TranslationUnit, source_file) or (None, '') on failure."""
        norm = os.path.normpath(os.path.abspath(file_path))

        with self._lock:
            if norm in self._cache:
                self._cache.move_to_end(norm)
                return self._cache[norm], self._sources[norm]

        # Parse outside lock
        entry, source_file = self.db.find(file_path)
        if not entry:
            log.warning("No compile entry for %s", file_path)
            return None, ""

        args = entry.get("arguments", [])
        directory = entry.get("directory", os.getcwd())
        minimal_args = _extract_minimal_args(args, directory)

        orig_cwd = os.getcwd()
        try:
            os.chdir(directory)
            cx = _clang_mod
            index = cx.Index.create()
            tu = index.parse(
                source_file,
                args=minimal_args,
                options=cx.TranslationUnit.PARSE_DETAILED_PROCESSING_RECORD,
            )
        except Exception as exc:
            log.error("Parse failed for %s: %s", source_file, exc)
            os.chdir(orig_cwd)
            return None, ""
        finally:
            os.chdir(orig_cwd)

        if not tu:
            return None, ""

        errs = [d for d in tu.diagnostics if d.severity >= 3]
        if errs:
            log.warning("%d parse errors in %s (partial ok)", len(errs), source_file)

        with self._lock:
            self._cache[norm] = tu
            self._sources[norm] = source_file
            self._cache.move_to_end(norm)
            if len(self._cache) > MAX_CACHED_TUS:
                self._cache.popitem(last=False)

        return tu, source_file

# ─── LSP helpers ─────────────────────────────────────────────────────────────
def _uri_to_path(uri: str) -> str:
    parsed = urlparse(uri)
    return unquote(parsed.path)

def _path_to_uri(path: str) -> str:
    return Path(os.path.abspath(path)).as_uri()

def _make_location(file: str, line: int, col: int) -> dict:
    """0-based LSP Location."""
    return {
        "uri": _path_to_uri(file),
        "range": {
            "start": {"line": max(0, line - 1), "character": max(0, col - 1)},
            "end":   {"line": max(0, line - 1), "character": max(0, col - 1)},
        },
    }

def _make_range(start_line: int, start_col: int, end_line: int, end_col: int) -> dict:
    return {
        "start": {"line": max(0, start_line - 1), "character": max(0, start_col - 1)},
        "end":   {"line": max(0, end_line - 1),   "character": max(0, end_col - 1)},
    }

def _cursor_location(cursor) -> dict:
    loc = cursor.location
    return _make_location(
        str(loc.file.name) if loc.file else "",
        loc.line, loc.column
    )

def _cursor_range(cursor) -> dict:
    ext = cursor.extent
    return _make_range(
        ext.start.line, ext.start.column,
        ext.end.line, ext.end.column,
    )

SYMBOL_KIND_MAP = {
    # clang CursorKind → LSP SymbolKind
    "NAMESPACE": 3,
    "CLASS_DECL": 5,
    "STRUCT_DECL": 23,
    "ENUM_DECL": 10,
    "FUNCTION_DECL": 12,
    "CXX_METHOD": 6,
    "CONSTRUCTOR": 9,
    "DESTRUCTOR": 9,
    "FIELD_DECL": 8,
    "VAR_DECL": 13,
    "ENUM_CONSTANT_DECL": 22,
}

def _symbol_kind(cursor) -> int:
    return SYMBOL_KIND_MAP.get(cursor.kind.name, 13)


# ─── AST walker helpers ───────────────────────────────────────────────────────
def _is_in_file(cursor, target_file: str) -> bool:
    if not cursor.location.file:
        return False
    cfile = str(cursor.location.file.name)
    tnorm = os.path.normpath(os.path.abspath(target_file))
    cnorm = os.path.normpath(os.path.abspath(cfile))
    if tnorm == cnorm:
        return True
    # stem match for .ut↔.cc
    ts = re.sub(r'\.(cc|cpp|cxx|ut)$', '', os.path.basename(tnorm))
    cs = re.sub(r'\.(cc|cpp|cxx|ut)$', '', os.path.basename(cnorm))
    return ts == cs


def _find_cursor_at(tu, source_file: str, line: int, col: int):
    """Return the most specific cursor at (line, col) in source_file."""
    cx = _clang_mod
    loc = cx.SourceLocation.from_position(tu, tu.get_file(source_file), line, col)
    return cx.Cursor.from_location(tu, loc)


def _get_qualified_name(cursor) -> str:
    cx = _clang_mod
    parts = []
    cur = cursor
    while cur and cur.kind != cx.CursorKind.TRANSLATION_UNIT:
        if cur.spelling:
            k = cur.kind
            if k in (cx.CursorKind.NAMESPACE, cx.CursorKind.CLASS_DECL,
                     cx.CursorKind.STRUCT_DECL, cx.CursorKind.CXX_METHOD,
                     cx.CursorKind.FUNCTION_DECL, cx.CursorKind.CONSTRUCTOR,
                     cx.CursorKind.DESTRUCTOR):
                parts.insert(0, cur.spelling)
        cur = cur.semantic_parent
    return "::".join(parts)


def _collect_symbols(cursor, source_file: str, results: list, limit: int) -> None:
    """Walk AST collecting SymbolInformation for documentSymbol."""
    cx = _clang_mod
    if len(results) >= limit:
        return
    if not _is_in_file(cursor, source_file):
        for child in cursor.get_children():
            _collect_symbols(child, source_file, results, limit)
        return

    WANTED = {
        cx.CursorKind.FUNCTION_DECL, cx.CursorKind.CXX_METHOD,
        cx.CursorKind.CONSTRUCTOR, cx.CursorKind.DESTRUCTOR,
        cx.CursorKind.CLASS_DECL, cx.CursorKind.STRUCT_DECL,
        cx.CursorKind.NAMESPACE, cx.CursorKind.ENUM_DECL,
        cx.CursorKind.FIELD_DECL, cx.CursorKind.VAR_DECL,
        cx.CursorKind.ENUM_CONSTANT_DECL,
    }
    if cursor.kind in WANTED and cursor.spelling:
        if cursor.kind not in (cx.CursorKind.FIELD_DECL, cx.CursorKind.VAR_DECL) or cursor.is_definition():
            results.append({
                "name": cursor.spelling,
                "kind": _symbol_kind(cursor),
                "location": {
                    "uri": _path_to_uri(str(cursor.location.file.name)),
                    "range": _cursor_range(cursor),
                },
                "containerName": cursor.semantic_parent.spelling
                    if cursor.semantic_parent else "",
            })
    for child in cursor.get_children():
        _collect_symbols(child, source_file, results, limit)


def _collect_callers(cursor, target_usr: str, source_file: str,
                     results: list, limit: int, seen: set) -> None:
    """Walk AST collecting call sites that reference target_usr."""
    cx = _clang_mod
    if len(results) >= limit:
        return
    if cursor.kind == cx.CursorKind.CALL_EXPR:
        ref = cursor.referenced
        if ref and ref.get_usr() == target_usr:
            if cursor.location.file:
                loc_key = (str(cursor.location.file.name), cursor.location.line)
                if loc_key not in seen:
                    seen.add(loc_key)
                    results.append({
                        "uri": _path_to_uri(str(cursor.location.file.name)),
                        "range": _cursor_range(cursor),
                    })
    for child in cursor.get_children():
        _collect_callers(child, target_usr, source_file, results, limit, seen)


def _collect_callees(cursor, source_file: str,
                     results: list, seen: set) -> None:
    """Collect outgoing calls from a function cursor."""
    cx = _clang_mod
    if cursor.kind == cx.CursorKind.CALL_EXPR:
        ref = cursor.referenced
        if ref and ref.spelling and not _is_noise_call(ref.spelling):
            if ref.location.file:
                key = ref.get_usr()
                if key not in seen:
                    seen.add(key)
                    results.append({
                        "name": ref.spelling,
                        "kind": _symbol_kind(ref),
                        "uri": _path_to_uri(str(ref.location.file.name)),
                        "range": _cursor_range(ref),
                        "selectionRange": _cursor_range(ref),
                    })
    for child in cursor.get_children():
        _collect_callees(child, source_file, results, seen)


# ─── request handlers ─────────────────────────────────────────────────────────
def handle_definition(cache: TUCache, params: dict) -> list:
    uri   = params["textDocument"]["uri"]
    line  = params["position"]["line"] + 1   # LSP 0-based → libclang 1-based
    col   = params["position"]["character"] + 1
    fpath = _uri_to_path(uri)

    tu, source_file = cache.get_or_parse(fpath)
    if not tu:
        return []

    cursor = _find_cursor_at(tu, source_file, line, col)
    if not cursor:
        return []

    ref = cursor.referenced or cursor.get_definition()
    if not ref or not ref.location.file:
        return []

    return [_make_location(
        str(ref.location.file.name),
        ref.location.line,
        ref.location.column,
    )]


def handle_references(cache: TUCache, params: dict) -> list:
    uri   = params["textDocument"]["uri"]
    line  = params["position"]["line"] + 1
    col   = params["position"]["character"] + 1
    fpath = _uri_to_path(uri)

    tu, source_file = cache.get_or_parse(fpath)
    if not tu:
        return []

    cursor = _find_cursor_at(tu, source_file, line, col)
    if not cursor:
        return []

    target_usr = cursor.referenced.get_usr() if cursor.referenced else cursor.get_usr()
    if not target_usr:
        return []

    results: list = []
    _collect_callers(tu.cursor, target_usr, source_file, results, limit=100, seen=set())
    return results


def handle_hover(cache: TUCache, params: dict) -> Optional[dict]:
    uri   = params["textDocument"]["uri"]
    line  = params["position"]["line"] + 1
    col   = params["position"]["character"] + 1
    fpath = _uri_to_path(uri)

    tu, source_file = cache.get_or_parse(fpath)
    if not tu:
        return None

    cursor = _find_cursor_at(tu, source_file, line, col)
    if not cursor or not cursor.spelling:
        return None

    parts = [f"**{cursor.spelling}**"]
    if cursor.type and cursor.type.spelling:
        parts.append(f"Type: `{cursor.type.spelling}`")
    if cursor.brief_comment:
        parts.append(cursor.brief_comment)
    if cursor.result_type and cursor.result_type.spelling:
        parts.append(f"Returns: `{cursor.result_type.spelling}`")
    # SMF hint
    if cursor.spelling.endswith("_imp"):
        parts.append("📋 SMF iterator method")

    return {"contents": {"kind": "markdown", "value": "\n\n".join(parts)}}


def handle_document_symbol(cache: TUCache, params: dict) -> list:
    uri   = params["textDocument"]["uri"]
    fpath = _uri_to_path(uri)

    tu, source_file = cache.get_or_parse(fpath)
    if not tu:
        return []

    results: list = []
    _collect_symbols(tu.cursor, source_file, results, limit=200)
    return results


def handle_implementation(cache: TUCache, params: dict) -> list:
    # Pure-virtual → concrete: same as definition for our use case
    return handle_definition(cache, params)


def handle_prepare_call_hierarchy(cache: TUCache, params: dict) -> list:
    uri   = params["textDocument"]["uri"]
    line  = params["position"]["line"] + 1
    col   = params["position"]["character"] + 1
    fpath = _uri_to_path(uri)

    tu, source_file = cache.get_or_parse(fpath)
    if not tu:
        return []

    cursor = _find_cursor_at(tu, source_file, line, col)
    if not cursor or not cursor.spelling:
        return []

    target = cursor.referenced or cursor
    if not target.location.file:
        return []

    return [{
        "name": target.spelling,
        "kind": _symbol_kind(target),
        "uri": _path_to_uri(str(target.location.file.name)),
        "range": _cursor_range(target),
        "selectionRange": _cursor_range(target),
        "data": {"usr": target.get_usr()},
    }]


def handle_incoming_calls(cache: TUCache, params: dict) -> list:
    item = params.get("item", {})
    uri  = item.get("uri", "")
    if not uri:
        return []
    fpath = _uri_to_path(uri)

    tu, source_file = cache.get_or_parse(fpath)
    if not tu:
        return []

    # Re-locate the item cursor by position
    pos  = item.get("selectionRange", {}).get("start", {})
    line = pos.get("line", 0) + 1
    col  = pos.get("character", 0) + 1
    cursor = _find_cursor_at(tu, source_file, line, col)
    if not cursor:
        return []

    target = cursor.referenced or cursor
    target_usr = target.get_usr()
    if not target_usr:
        return []

    call_sites: list = []
    _collect_callers(tu.cursor, target_usr, source_file, call_sites, limit=50, seen=set())

    return [{
        "from": {
            "name": target.spelling,
            "kind": _symbol_kind(target),
            "uri": site["uri"],
            "range": site["range"],
            "selectionRange": site["range"],
        },
        "fromRanges": [site["range"]],
    } for site in call_sites]


def handle_outgoing_calls(cache: TUCache, params: dict) -> list:
    item = params.get("item", {})
    uri  = item.get("uri", "")
    if not uri:
        return []
    fpath = _uri_to_path(uri)

    tu, source_file = cache.get_or_parse(fpath)
    if not tu:
        return []

    pos  = item.get("selectionRange", {}).get("start", {})
    line = pos.get("line", 0) + 1
    col  = pos.get("character", 0) + 1
    cursor = _find_cursor_at(tu, source_file, line, col)
    if not cursor:
        return []

    # Find the enclosing function body cursor
    cx  = _clang_mod
    FN_KINDS = {cx.CursorKind.FUNCTION_DECL, cx.CursorKind.CXX_METHOD,
                cx.CursorKind.CONSTRUCTOR, cx.CursorKind.DESTRUCTOR}
    fn_cursor = cursor
    while fn_cursor and fn_cursor.kind not in FN_KINDS:
        fn_cursor = fn_cursor.semantic_parent
    if not fn_cursor or fn_cursor.kind not in FN_KINDS:
        fn_cursor = cursor

    callees: list = []
    _collect_callees(fn_cursor, source_file, callees, seen=set())

    return [{
        "to": c,
        "fromRanges": [c["range"]],
    } for c in callees]


def handle_diagnostics(cache: TUCache, params: dict) -> dict:
    uri   = params["textDocument"]["uri"]
    fpath = _uri_to_path(uri)

    tu, _ = cache.get_or_parse(fpath)
    if not tu:
        return {"kind": "full", "items": []}

    SEV_MAP = {1: "error", 2: "warning", 3: "information", 4: "hint"}
    items = []
    for d in tu.diagnostics:
        if d.severity < 2:  # ignore notes
            continue
        loc = d.location
        if not loc.file:
            continue
        items.append({
            "range": _make_range(loc.line, loc.column, loc.line, loc.column),
            "severity": d.severity,
            "message": d.spelling,
            "source": "clang",
        })
    return {"kind": "full", "items": items}


def handle_workspace_symbol(cache: TUCache, params: dict) -> list:
    # We can only search TUs that are already cached.
    # Good enough — model will have opened relevant files first.
    query = (params.get("query") or "").lower()
    results: list = []
    with cache._lock:
        cached_paths = list(cache._sources.items())

    for norm, source_file in cached_paths:
        tu = cache._cache.get(norm)
        if not tu:
            continue
        syms: list = []
        _collect_symbols(tu.cursor, source_file, syms, limit=50)
        for s in syms:
            if not query or query in s["name"].lower():
                results.append(s)
        if len(results) >= 100:
            break

    return results[:100]


# ─── JSON-RPC server (stdio) ──────────────────────────────────────────────────
class OntapLspServer:
    """
    Minimal LSP server over stdio using the same Content-Length framing
    that APEX's LspConnectionFactory produces and expects.
    """

    CAPABILITIES = {
        "definitionProvider": True,
        "referencesProvider": True,
        "hoverProvider": True,
        "documentSymbolProvider": True,
        "implementationProvider": True,
        "callHierarchyProvider": True,
        "diagnosticProvider": {"interFileDependencies": False, "workspaceDiagnostics": False},
        "workspaceSymbolProvider": True,
        "codeActionProvider": False,
    }

    def __init__(self, compile_commands: str, libclang: Optional[str] = None):
        if not _init_clang(libclang):
            raise RuntimeError("libclang unavailable — cannot start LSP bridge")
        self.db    = CompileDB(compile_commands)
        self.cache = TUCache(self.db)
        self._buf  = b""
        self._running = True
        # pre-open TU threads
        self._parse_executor = None  # could add ThreadPoolExecutor here

    # ── wire ─────────────────────────────────────────────────────────────────
    def _write(self, obj: Any) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
        sys.stdout.buffer.write(header + body)
        sys.stdout.buffer.flush()

    def _send_response(self, req_id: Any, result: Any) -> None:
        self._write({"jsonrpc": "2.0", "id": req_id, "result": result})

    def _send_error(self, req_id: Any, code: int, msg: str) -> None:
        self._write({"jsonrpc": "2.0", "id": req_id,
                     "error": {"code": code, "message": msg}})

    def _read_message(self) -> Optional[dict]:
        """Block until a complete JSON-RPC message arrives on stdin."""
        inp = sys.stdin.buffer
        while self._running:
            # accumulate until we have headers
            while b"\r\n\r\n" not in self._buf:
                chunk = inp.read(4096)
                if not chunk:
                    return None
                self._buf += chunk

            header_end = self._buf.index(b"\r\n\r\n")
            header = self._buf[:header_end].decode("ascii", errors="replace")
            m = re.search(r"Content-Length:\s*(\d+)", header, re.IGNORECASE)
            if not m:
                self._buf = self._buf[header_end + 4:]
                continue
            length = int(m.group(1))
            body_start = header_end + 4
            while len(self._buf) < body_start + length:
                chunk = inp.read(4096)
                if not chunk:
                    return None
                self._buf += chunk

            body = self._buf[body_start:body_start + length]
            self._buf = self._buf[body_start + length:]
            try:
                return json.loads(body.decode("utf-8"))
            except json.JSONDecodeError as e:
                log.error("JSON parse error: %s", e)
                return None
        return None

    # ── dispatch ─────────────────────────────────────────────────────────────
    def _dispatch(self, msg: dict) -> None:
        method = msg.get("method", "")
        params = msg.get("params") or {}
        req_id = msg.get("id")            # None → notification, no response

        # Notifications (no id) — handle fire-and-forget
        if req_id is None:
            if method == "textDocument/didOpen":
                # Parse in background thread to warm cache
                td = params.get("textDocument", {})
                uri = td.get("uri", "")
                if uri:
                    t = threading.Thread(
                        target=self.cache.get_or_parse,
                        args=(_uri_to_path(uri),),
                        daemon=True,
                    )
                    t.start()
            return  # notifications never get responses

        # Requests
        try:
            result = self._handle_request(method, params)
            self._send_response(req_id, result)
        except Exception as exc:
            log.exception("Error handling %s", method)
            self._send_error(req_id, -32603, str(exc))

    def _handle_request(self, method: str, params: dict) -> Any:
        if method == "initialize":
            return {
                "capabilities": self.CAPABILITIES,
                "serverInfo": {"name": "ontap-lsp-bridge", "version": "1.0"},
            }

        if method == "shutdown":
            self._running = False
            return None

        if method == "textDocument/definition":
            return handle_definition(self.cache, params)

        if method == "textDocument/references":
            return handle_references(self.cache, params)

        if method == "textDocument/hover":
            return handle_hover(self.cache, params)

        if method == "textDocument/documentSymbol":
            return handle_document_symbol(self.cache, params)

        if method == "textDocument/implementation":
            return handle_implementation(self.cache, params)

        if method == "textDocument/prepareCallHierarchy":
            return handle_prepare_call_hierarchy(self.cache, params)

        if method == "callHierarchy/incomingCalls":
            return handle_incoming_calls(self.cache, params)

        if method == "callHierarchy/outgoingCalls":
            return handle_outgoing_calls(self.cache, params)

        if method == "textDocument/diagnostic":
            return handle_diagnostics(self.cache, params)

        if method == "workspace/diagnostic":
            return {"items": []}  # workspace-wide not indexed

        if method == "workspace/symbol":
            return handle_workspace_symbol(self.cache, params)

        if method in ("textDocument/codeAction", "initialized",
                      "workspace/didChangeConfiguration",
                      "workspace/didChangeWorkspaceFolders",
                      "textDocument/didChange", "textDocument/didClose"):
            return None  # acknowledged, no-op

        # Unknown method — LSP says return null for unrecognised requests
        log.warning("Unhandled method: %s", method)
        return None

    def run(self) -> None:
        log.warning("ONTAP LSP bridge ready (pid=%d)", os.getpid())
        while self._running:
            msg = self._read_message()
            if msg is None:
                break
            self._dispatch(msg)
        log.warning("ONTAP LSP bridge exiting")


# ─── entry point ─────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="ONTAP LSP Bridge")
    ap.add_argument(
        "--compile-commands", "-c",
        default=None,
        help="Path to compile_commands.json (auto-discovered if omitted)",
    )
    ap.add_argument(
        "--libclang", "-l",
        default=None,
        help="Path to libclang.so (falls back to well-known locations)",
    )
    ap.add_argument(
        "--log-level",
        default="WARNING",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = ap.parse_args()

    logging.getLogger().setLevel(args.log_level)

    # Auto-discover compile_commands.json
    compile_commands = args.compile_commands
    if not compile_commands:
        cwd = Path.cwd()
        for parent in [cwd, *cwd.parents]:
            candidate = parent / "compile_commands.json"
            if candidate.exists():
                compile_commands = str(candidate)
                break
    if not compile_commands:
        log.error("compile_commands.json not found. Pass --compile-commands")
        return 1

    try:
        server = OntapLspServer(compile_commands, libclang=args.libclang)
        server.run()
    except Exception as exc:
        log.exception("Fatal: %s", exc)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
