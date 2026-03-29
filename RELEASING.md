# Release Checklist

Before tagging vX.Y.Z:

- [ ] Update version in ALL 6 locations:
  - package.json → version
  - package-lock.json → version
  - openclaw.plugin.json → version
  - index.ts → JSDoc header '* Version: X.Y.Z'
  - index.ts → startup log string 'plugin vX.Y.Z loaded'
  - src/client/memoryrelay-client.ts → User-Agent header
- [ ] CHANGELOG.md → [X.Y.Z] - YYYY-MM-DD entry complete
- [ ] npm test passes (all tests green)
- [ ] git tag vX.Y.Z && git push origin vX.Y.Z (CI/CD auto-publishes to npm)

## Note on plugins install
openclaw plugins install refuses to overwrite existing extensions.
Users must: rm -rf ~/.openclaw/extensions/plugin-memoryrelay-ai first.
Workaround command:
  mkdir /tmp/mr && cd /tmp/mr && npm pack @memoryrelay/plugin-memoryrelay-ai@LATEST && tar -xzf *.tgz && rm -rf ~/.openclaw/extensions/plugin-memoryrelay-ai && cp -r package ~/.openclaw/extensions/plugin-memoryrelay-ai && rm -rf /tmp/mr && cd ~ && openclaw gateway restart
