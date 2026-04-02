# Ignoring Files

This document provides an overview of the Qwen Ignore (`.apexignore`) feature of APEX.

APEX includes the ability to automatically ignore files, similar to `.gitignore` (used by Git). Adding paths to your `.apexignore` file will exclude them from tools that support this feature, although they will still be visible to other services (such as Git).

## How it works

When you add a path to your `.apexignore` file, tools that respect this file will exclude matching files and directories from their operations. For example, when you use the [`read_many_files`](../../developers/tools/multi-file) command, any paths in your `.apexignore` file will be automatically excluded.

For the most part, `.apexignore` follows the conventions of `.gitignore` files:

- Blank lines and lines starting with `#` are ignored.
- Standard glob patterns are supported (such as `*`, `?`, and `[]`).
- Putting a `/` at the end will only match directories.
- Putting a `/` at the beginning anchors the path relative to the `.apexignore` file.
- `!` negates a pattern.

You can update your `.apexignore` file at any time. To apply the changes, you must restart your APEX session.

## How to use `.apexignore`

| Step                   | Description                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------- |
| **Enable .apexignore** | Create a file named `.apexignore` in your project root directory                       |
| **Add ignore rules**   | Open `.apexignore` file and add paths to ignore, example: `/archive/` or `apikeys.txt` |

### `.apexignore` examples

You can use `.apexignore` to ignore directories and files:

```
# Exclude your /packages/ directory and all subdirectories
/packages/

# Exclude your apikeys.txt file
apikeys.txt
```

You can use wildcards in your `.apexignore` file with `*`:

```
# Exclude all .md files
*.md
```

Finally, you can exclude files and directories from exclusion with `!`:

```
# Exclude all .md files except README.md
*.md
!README.md
```

To remove paths from your `.apexignore` file, delete the relevant lines.
