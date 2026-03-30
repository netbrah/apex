# ONTAP LSP Bridge

A ~900-line Python LSP server that wraps NetApp's `libclang` to give APEX
precise C/C++ code intelligence on the ONTAP codebase — without the background
indexer that makes full clangd unusable at ONTAP scale.

## Architecture

```
APEX LspTool (TS)
  └── NativeLspService
        └── LspConnectionFactory (JSON-RPC/stdio)
              └── ontap_lsp_bridge.py
                    ├── CompileDB   (compile_commands.json, hot-reload on mtime)
                    ├── TUCache     (LRU-8, per-file TU, parse-on-demand)
                    └── libclang    (/x/eng/.../llvm-19.1.7-n7478241/lib/libclang.so)
```

## Why not full clangd?

ONTAP has ~70k source files. clangd's `--background-index` builds a persistent
index across all of them — saturates I/O for hours. Even per-file preamble
parsing hits deep include chains that take 5–30s.

This bridge does **none of that**. It parses one TU on demand, caches the last
8, and answers LSP queries from the cached AST. First request for a file takes
0.5–3s; all subsequent requests are instant cursor traversals.

## ONTAP-specific features

- **`.ut → generated .cc` mapping**: `.ut` files appear in compile_commands
  with the real source being a generated `.cc` in `bedrock/`. The bridge
  resolves this transparently — APEX can ask for symbols in `foo.ut` and the
  bridge parses the right generated file.
- **Noise filter**: traceError/traceDebug/std::/boost:: calls suppressed from
  call hierarchy results (same filter as mastra-search).
- **SMF detection**: hover tooltip marks `_imp` methods as "📋 SMF iterator method".
- **compile_commands hot-reload**: mtime-watched, reloads automatically after
  build system regenerates it.

## Supported LSP Operations

All 12 operations exposed by the APEX `LspTool`:

| Operation            | Method                              | Notes                        |
| -------------------- | ----------------------------------- | ---------------------------- |
| goToDefinition       | `textDocument/definition`           | Precise — uses USR           |
| findReferences       | `textDocument/references`           | Within cached TU             |
| hover                | `textDocument/hover`                | Type + return type + comment |
| documentSymbol       | `textDocument/documentSymbol`       | All defs in file             |
| workspaceSymbol      | `workspace/symbol`                  | Searches cached TUs only     |
| goToImplementation   | `textDocument/implementation`       | Same as definition           |
| prepareCallHierarchy | `textDocument/prepareCallHierarchy` | Returns item for follow-up   |
| incomingCalls        | `callHierarchy/incomingCalls`       | Callers within TU            |
| outgoingCalls        | `callHierarchy/outgoingCalls`       | Callees, noise-filtered      |
| diagnostics          | `textDocument/diagnostic`           | clang errors/warnings        |
| workspaceDiagnostics | `workspace/diagnostic`              | Returns [] (not indexed)     |
| codeActions          | `textDocument/codeAction`           | Returns [] (not implemented) |

## Setup in APEX (apex-embed-assets branch)

### 1. Bundle the bridge

The bridge is bundled into the APEX SEA binary as a skill asset. It is written
to `~/.apex/bin/ontap_lsp_bridge.py` by the postinstall script.

### 2. Configure settings.json (in `feat/apex-embed-assets`)

Add to the APEX default `settings.json`:

```json
{
  "lsp": {
    "enabled": true
  },
  "lspServers": {
    "c": {
      "command": "python3.11",
      "args": [
        "${HOME}/.apex/bin/ontap_lsp_bridge.py",
        "--compile-commands",
        "${workspacePath}/compile_commands.json",
        "--libclang",
        "/x/eng/btools/arch/x86_64-redhat-rhel7/compilers_n_tools/pkgs/llvm-19.1.7-n7478241/lib/libclang.so"
      ],
      "transport": "stdio",
      "extensionToLanguage": {
        ".c": "c",
        ".cc": "c",
        ".cpp": "c",
        ".h": "c",
        ".ut": "c"
      }
    }
  }
}
```

The `${workspacePath}` variable is resolved by `LspConfigLoader.hydrateExtensionLspConfig`.

### 3. Alternative: .lsp.json in ONTAP workspace root

Users can also drop a `.lsp.json` in their ONTAP workspace root — takes
priority over the bundled settings:

```json
{
  "c": {
    "command": "python3.11",
    "args": [
      "~/.apex/bin/ontap_lsp_bridge.py",
      "--compile-commands",
      "./compile_commands.json"
    ],
    "transport": "stdio",
    "extensionToLanguage": {
      ".c": "c",
      ".cc": "c",
      ".h": "c",
      ".ut": "c"
    }
  }
}
```

## Updatability

The bridge is a single Python file with no dependencies beyond stdlib + `clang.cindex`
(which uses `libclang.so` via ctypes — no pip install needed if libclang.so is present).

To update:

- Replace `~/.apex/bin/ontap_lsp_bridge.py` — the server respawns on next APEX launch.
- No APEX rebuild required.
- The LLVM path is a flag, not hardcoded — updating LLVM just means changing the arg.

## Known Limitations

- `findReferences` / `incomingCalls` are **within-TU only** — cross-file caller
  resolution requires a global index. Use mastra-search `call_graph_fast` for
  cross-file call graph traversal (it's better at this anyway — it uses the
  ONTAP-specific OpenGrok index).
- `workspaceSymbol` only searches cached TUs (files already opened this session).
- First parse of a deeply-included file (e.g. keymanager_key.cc) may take 2–5s.
  Subsequent requests are instant.
- No code completion — the APEX model doesn't use completion, it writes full edits.
