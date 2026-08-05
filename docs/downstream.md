# Anti-slop downstream setup

The `recommended` registry item installs the versioned
`@austinm911/anti-slop` package from GitHub.

Add these scripts to the downstream `package.json`:

```json
{
  "scripts": {
    "lint:ast": "anti-slop scan apps packages projects tools",
    "lint:ast:test": "anti-slop test"
  }
}
```

Choose scan roots that exist in the downstream repository. Put `lint:ast` in
the repository's normal check command.
