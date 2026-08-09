---
description: Refuse Record<string, unknown> and preserve domain contracts
condition: "Record(?:\\s|/\\*[\\s\\S]*?\\*/|//[^\\n]*(?:\\n|$))*<(?:\\s|/\\*[\\s\\S]*?\\*/|//[^\\n]*(?:\\n|$))*string(?:\\s|/\\*[\\s\\S]*?\\*/|//[^\\n]*(?:\\n|$))*,(?:\\s|/\\*[\\s\\S]*?\\*/|//[^\\n]*(?:\\n|$))*unknown(?:\\s|/\\*[\\s\\S]*?\\*/|//[^\\n]*(?:\\n|$))*>"
scope: "tool:edit(*.{ts,tsx,mts,cts}), tool:write(*.{ts,tsx,mts,cts})"
---

You were about to introduce `Record<string, unknown>`. Stop.

This type erases the object's contract and lets unparsed data spread through the
codebase. Replace it with a strongly typed domain type. Parse the value as early
as possible and as close as possible to the I/O boundary where it originated.

Use one of these instead:

- Parse external data with the repository's schema library, then use its typed
  output.
- Define a domain type when the shape is known.
- Keep raw input as `unknown` only until the boundary parser validates it.
- Use a generic when the caller supplies the shape.

Do not replace it with `{ [key: string]: unknown }`, `object`, or `any`. Those
forms preserve the same type erasure.
